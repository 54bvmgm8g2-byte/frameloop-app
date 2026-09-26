import { StatusBar } from 'expo-status-bar';
import { CameraType, CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import * as Sharing from 'expo-sharing';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, Animated, AppState, Image, KeyboardAvoidingView, Platform, Pressable,
  Linking, SafeAreaView, ScrollView, StatusBar as RNStatusBar, StyleSheet, Text,
  TextInput, View,
} from 'react-native';
import { exportBackup, importBackup, loadProjects, persistImage, saveProjects } from './storage';
import { c } from './theme';
import { Category, ProgressPhoto, Project, Screen } from './types';
import { createTimelapse, saveVideoToLibrary, shareVideo } from './videoExport';

const cats: { key: Category; label: string; icon: string }[] = [
  { key: 'people', label: '사람', icon: '◉' }, { key: 'spaces', label: '공간', icon: '⌂' },
  { key: 'nature', label: '자연', icon: '✦' }, { key: 'hobbies', label: '취미', icon: '✎' },
  { key: 'other', label: '기타', icon: '＋' },
];
const reminders = { daily: '매일', weekly: '매주', monthly: '매월', none: '알림 없음' } as const;
const fmt = (d: string) => new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(d));
const days = (d: string) => Math.max(1, Math.floor((Date.now() - new Date(d).getTime()) / 86400000) + 1);

function Button({ label, onPress, secondary, disabled }: { label: string; onPress: () => void; secondary?: boolean; disabled?: boolean }) {
  return <Pressable disabled={disabled} onPress={onPress} style={({ pressed }) => [s.button, secondary && s.buttonSecondary, disabled && { opacity: .35 }, pressed && { opacity: .8 }]}>
    <Text style={[s.buttonText, secondary && { color: c.blue }]}>{label}</Text>
  </Pressable>;
}
function Header({ title, back, more }: { title: string; back?: () => void; more?: () => void }) {
  return <View style={s.header}>
    <View style={s.headerSide}>{back && <Pressable onPress={back} hitSlop={12}><Text style={s.back}>‹</Text></Pressable>}</View>
    <Text numberOfLines={1} style={s.headerTitle}>{title}</Text>
    <View style={[s.headerSide, { alignItems: 'flex-end' }]}>{more && <Pressable onPress={more}><Text style={s.more}>•••</Text></Pressable>}</View>
  </View>;
}
function EmptyArt() {
  return <View style={s.art}><View style={s.artBack}/><View style={s.artFront}><View style={s.sun}/><View style={s.hill}/></View></View>;
}
async function openAdPrivacyOptions() {
  try {
    const { showAdPrivacyOptions } = await import('./rewardedAds');
    const result = await showAdPrivacyOptions();
    if (result === 'not-required') Alert.alert('광고 개인정보 설정', '현재 지역에서는 별도의 광고 개인정보 설정이 필요하지 않아요.');
    else if (result === 'unavailable') Alert.alert('광고 개인정보 안내', '현재 변경할 광고 개인정보 설정이 없어요. 광고는 개인정보 보호 방식으로 요청됩니다.');
  } catch {
    Alert.alert('광고 개인정보 안내', '현재 변경할 광고 개인정보 설정이 없어요. 광고는 개인정보 보호 방식으로 요청됩니다.');
  }
}
function openHomeMenu(projects: Project[], onImported: (projects: Project[]) => void) {
  Alert.alert('FrameLoop 안내', '확인할 항목을 선택하세요.', [
    { text: '기기 저장 안내', onPress: () => Alert.alert('기기 저장 안내', '사진과 프로젝트는 서버로 전송되지 않고 이 휴대폰에만 저장돼요. 앱을 삭제하면 기록을 복구할 수 없으니 완성 영상은 사진 앱에 저장해주세요.') },
    { text: '광고 개인정보 설정', onPress: () => void openAdPrivacyOptions() },
    { text: '기록 백업하기', onPress: () => void exportBackup(projects).then(uri => Sharing.shareAsync(uri, { mimeType: 'application/zip', UTI: 'public.zip-archive', dialogTitle: 'FrameLoop 백업 공유' })).then(() => Alert.alert('백업 완료', '파일 앱이나 AirDrop으로 새 기기에 보내세요.')).catch(() => Alert.alert('백업 실패', '잠시 후 다시 시도해주세요.')) },
    { text: '백업 복원하기', onPress: () => void importBackup().then(restored => { if (restored) { onImported(restored); Alert.alert('복원 완료', `${restored.length}개 프로젝트를 복원했어요.`); } }).catch(e => Alert.alert('복원 실패', e instanceof Error ? e.message : '백업 파일을 확인해주세요.')) },
    { text: '닫기', style: 'cancel' },
  ]);
}
function BottomNav({ active, go }: { active: 'home' | 'library'; go: (x: Screen) => void }) {
  const data = [
    { key: 'home', label: '홈', icon: '⌂', action: () => go({ name: 'home' }) },
    { key: 'add', label: '촬영', icon: '◎', action: () => go({ name: 'create' }) },
    { key: 'library', label: '보관함', icon: '▦', action: () => go({ name: 'library' }) },
  ];
  return <View style={s.nav}>{data.map(x => <Pressable key={x.key} onPress={x.action} style={[s.navItem,x.key==='add'&&s.navAdd]}>
    <View style={[s.navIconBox,x.key==='add'&&s.navAddIcon]}><Text style={[s.navIcon, x.key==='home'&&s.navHomeIcon,x.key==='library'&&s.navLibraryIcon, active === x.key && s.navOn,x.key==='add'&&s.navCameraIcon]}>{x.icon}</Text></View><Text style={[s.navText, active === x.key && s.navOn,x.key==='add'&&{color:c.text}]}>{x.label}</Text>
  </Pressable>)}</View>;
}

function Home({ projects, go, onImported }: { projects: Project[]; go: (x: Screen) => void; onImported: (projects: Project[]) => void }) {
  const [filter, setFilter] = useState<Category | 'all'>('all');
  const shown = filter === 'all' ? projects : projects.filter(x => x.category === filter);
  return <SafeAreaView style={s.safe}><ScrollView contentContainerStyle={s.page} showsVerticalScrollIndicator={false}>
    <View style={s.homeTop}><Text style={s.brand}>FrameLoop</Text><Pressable onPress={() => openHomeMenu(projects, onImported)} style={s.topIcon}><Text style={s.topIconText}>•••</Text></Pressable></View>
    <View style={s.hero}><View><Text style={s.title}>나의 변화</Text><Text style={s.homeSub}>오늘의 작은 변화를 같은 구도로 남겨보세요.</Text></View></View>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chips}>
      {[{ key: 'all', label: '전체' }, ...cats.slice(0, 4)].map(x => <Pressable key={x.key} onPress={() => setFilter(x.key as any)} style={[s.chip, filter === x.key && s.chipOn]}><Text style={[s.chipText, filter === x.key && s.chipTextOn]}>{x.label}</Text></Pressable>)}
    </ScrollView>
    {!shown.length ? <View style={s.empty}><EmptyArt/><Text style={s.emptyTitle}>첫 변화를 기록해볼까요?</Text><Text style={s.emptyCopy}>같은 구도로 찍을수록 작은 변화가 더 선명하게 보여요.</Text><Button label="새 프로젝트 만들기" onPress={() => go({ name: 'create' })}/></View>
      : <View style={{ gap: 12 }}>{shown.map(p => { const photo = p.photos.at(-1); const cat = cats.find(x => x.key === p.category); return <Pressable key={p.id} onPress={() => go({ name: 'project', projectId: p.id })} style={({pressed})=>[s.card,pressed&&s.pressed]}>
        {photo ? <Image source={{ uri: photo.uri }} style={s.thumb}/> : <View style={[s.thumb, s.thumbEmpty]}><Text style={s.thumbIcon}>{cat?.icon}</Text></View>}
        <View style={s.cardCopy}><Text style={s.cardTitle}>{p.title}</Text><Text style={s.meta}>{days(p.createdAt)}일째 · 사진 {p.photos.length}장</Text>
          <View style={s.cardProgress}><View style={[s.cardProgressFill,{width:`${Math.min(100,Math.max(10,p.photos.length*12))}%`}]}/></View><Text style={s.cardHint}>{p.photos.length?'기록 이어가기':'첫 사진 남기기'}</Text></View><Text style={s.chev}>›</Text>
      </Pressable>})}</View>}
  </ScrollView><BottomNav active="home" go={go}/></SafeAreaView>;
}

function Create({ back, create }: { back: () => void; create: (x: Project) => void }) {
  const [title, setTitle] = useState(''); const [category, setCategory] = useState<Category>('people'); const [reminder, setReminder] = useState<Project['reminder']>('weekly');
  const submit = () => title.trim() && create({ id: String(Date.now()), title: title.trim(), category, reminder, createdAt: new Date().toISOString(), photos: [] });
  return <SafeAreaView style={s.safe}><Header title="새로운 변화" back={back}/><KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}><ScrollView contentContainerStyle={s.form} keyboardShouldPersistTaps="handled">
    <Text style={s.formIntro}>무엇이 달라지는지{`\n`}기록해보세요.</Text><Text style={s.label}>프로젝트 이름</Text>
    <TextInput autoFocus maxLength={40} value={title} onChangeText={setTitle} placeholder="예: 머리 기르는 과정" placeholderTextColor="#A2A6B0" style={s.input}/>
    <Text style={s.label}>카테고리</Text><View style={s.catGrid}>{cats.map(x => <Pressable key={x.key} onPress={() => setCategory(x.key)} style={[s.cat, category === x.key && s.catOn]}><Text style={[s.catIcon, category === x.key && s.blue]}>{x.icon}</Text><Text style={[s.catText, category === x.key && s.blue]}>{x.label}</Text></Pressable>)}</View>
    <Text style={s.label}>촬영 알림</Text><View style={s.reminders}>{(Object.keys(reminders) as Project['reminder'][]).map(x => <Pressable key={x} onPress={() => setReminder(x)} style={[s.reminder, reminder === x && s.reminderOn]}><Text style={[s.reminderText, reminder === x && { color: '#fff' }]}>{reminders[x]}</Text></Pressable>)}</View>
    <View style={{ height: 26 }}/><Button label="프로젝트 만들기" onPress={submit} disabled={!title.trim()}/><Text style={s.privacy}>사진은 계정 없이 이 기기에만 저장돼요.</Text>
  </ScrollView></KeyboardAvoidingView></SafeAreaView>;
}

function ProjectView({ project, go, remove }: { project: Project; go: (x: Screen) => void; remove: () => void }) {
  const askDelete = () => Alert.alert('프로젝트를 삭제할까요?', '기록 목록도 함께 사라져요.', [{ text: '취소', style: 'cancel' }, { text: '삭제', style: 'destructive', onPress: remove }]);
  return <SafeAreaView style={s.safe}><Header title={project.title} back={() => go({ name: 'home' })} more={askDelete}/><ScrollView contentContainerStyle={s.projectPage}>
    {project.photos.at(-1) ? <View style={s.projectCover}><Image source={{uri:project.photos.at(-1)!.uri}} style={s.projectCoverImage}/><View style={s.projectCoverShade}/><View style={s.projectCoverCopy}><Text style={s.projectCoverKicker}>DAY {days(project.createdAt)}</Text><Text style={s.projectCoverTitle}>{project.title}</Text><Text style={s.projectCoverMeta}>{fmt(project.photos.at(-1)!.createdAt)} 최근 기록</Text></View></View> : null}
    <View style={s.stats}><Stat value={String(days(project.createdAt))} label="기록 일수"/><View style={s.divider}/><Stat value={String(project.photos.length)} label="사진"/><View style={s.divider}/><Stat value={reminders[project.reminder]} label="촬영 주기"/></View>
    <View style={s.quickActions}><QuickAction icon="◎" label="촬영" primary onPress={() => go({ name: 'camera', projectId: project.id })}/><QuickAction icon="◐" label="비교" disabled={project.photos.length<2} onPress={() => go({ name: 'compare', projectId: project.id })}/><QuickAction icon="▶" label="재생" disabled={project.photos.length<2} onPress={() => go({ name: 'playback', projectId: project.id })}/></View>
    <View style={s.sectionHead}><Text style={s.sectionTitle}>타임라인</Text><Text style={s.sectionCount}>{project.photos.length}개</Text></View>
    {!project.photos.length ? <View style={s.timelineEmpty}><Text style={s.timelineIcon}>◎</Text><Text style={s.timelineTitle}>아직 기록이 없어요</Text><Text style={s.timelineCopy}>첫 사진이 앞으로 촬영할 모든 사진의 기준이 돼요.</Text></View>
      : <View>{[...project.photos].reverse().map((p, i) => <View key={p.id} style={s.timelineRow}><View style={s.rail}><View style={s.dot}/>{i < project.photos.length - 1 && <View style={s.line}/>}</View><Image source={{ uri: p.uri }} style={s.timelineImage}/><View style={s.timelineWords}><Text style={s.timelineDate}>{fmt(p.createdAt)}</Text><Text style={s.meta}>기록 {project.photos.length - i}번째</Text></View></View>)}</View>}
  </ScrollView></SafeAreaView>;
}
function Stat({ value, label }: { value: string; label: string }) { return <View style={{ minWidth: 72 }}><Text style={s.statValue}>{value}</Text><Text style={s.statLabel}>{label}</Text></View>; }
function QuickAction({icon,label,onPress,primary,disabled}:{icon:string;label:string;onPress:()=>void;primary?:boolean;disabled?:boolean}) { return <Pressable disabled={disabled} onPress={onPress} style={({pressed})=>[s.quickAction,primary&&s.quickActionPrimary,disabled&&{opacity:.35},pressed&&s.pressed]}><Text style={[s.quickIcon,primary&&{color:'#fff'}]}>{icon}</Text><Text style={[s.quickLabel,primary&&{color:'#fff'}]}>{label}</Text></Pressable>; }

function Camera({ project, back, add }: { project: Project; back: () => void; add: (x: ProgressPhoto) => void }) {
  const ref = useRef<CameraView>(null); const [permission, ask] = useCameraPermissions(); const requestedPermission = useRef(false); const [facing, setFacing] = useState<CameraType>('back'); const [opacity, setOpacity] = useState(.45); const [busy, setBusy] = useState(false); const [countdown, setCountdown] = useState<number | null>(null); const previous = project.photos.at(-1);
  const save = async (uri: string) => { setBusy(true); try { add({ id: String(Date.now()), uri: await persistImage(uri), createdAt: new Date().toISOString() }); } catch { Alert.alert('저장하지 못했어요', '잠시 후 다시 시도해주세요.'); } finally { setBusy(false); } };
  const capture = async () => { if (!ref.current || busy) return; const result = await ref.current.takePictureAsync({ quality: .9 }); if (result?.uri) await save(result.uri); };
  const pick = async () => { const x = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: .9 }); if (!x.canceled && x.assets[0]) await save(x.assets[0].uri); };
  useEffect(() => {
    if (countdown === null) return;
    if (countdown === 0) { setCountdown(null); void capture(); return; }
    const timer = setTimeout(() => setCountdown(value => value === null ? null : value - 1), 1000);
    return () => clearTimeout(timer);
  }, [countdown]);
  useEffect(() => {
    if (!permission || permission.granted || !permission.canAskAgain || requestedPermission.current) return;
    requestedPermission.current = true;
    void ask();
  }, [permission, ask]);
  const startTimer = () => { if (!busy && countdown === null) setCountdown(3); };
  if (!permission) return <View style={[s.safe, s.center]}><ActivityIndicator color={c.blue}/></View>;
  if (!permission.granted && permission.canAskAgain) return <View style={[s.safe, s.center]}><ActivityIndicator color={c.blue}/></View>;
  if (!permission.granted) return <SafeAreaView style={s.permission}><Text style={s.permissionIcon}>◎</Text><Text style={s.permissionTitle}>카메라 접근이 꺼져 있어요</Text><Text style={s.permissionCopy}>설정에서 카메라 접근을 허용하면 같은 구도로 변화 사진을 촬영할 수 있어요.</Text><Button label="설정 열기" onPress={() => void Linking.openSettings()}/><Pressable onPress={pick}><Text style={s.importLink}>사진첩에서 가져오기</Text></Pressable><Pressable onPress={back}><Text style={s.cancel}>돌아가기</Text></Pressable></SafeAreaView>;
  return <View style={s.cameraPage}><StatusBar style="light"/><CameraView ref={ref} style={s.cameraPreview} facing={facing} active/>
    <View pointerEvents="box-none" style={s.cameraOverlay}>
      {previous && <Image source={{ uri: previous.uri }} style={[StyleSheet.absoluteFill, { opacity }]} resizeMode="cover"/>}<Grid/>
      {countdown !== null && countdown > 0 && <View pointerEvents="none" style={s.countdown}><Text style={s.countdownText}>{countdown}</Text></View>}
      <View style={s.cameraTop}><Pressable onPress={back} style={s.round}><Text style={s.roundText}>×</Text></Pressable><Text style={s.cameraTitle}>{previous ? '이전 프레임에 맞춰보세요' : '첫 기준사진을 촬영하세요'}</Text><Pressable onPress={() => setFacing(x => x === 'back' ? 'front' : 'back')} style={s.round}><Text style={s.roundText}>↻</Text></Pressable></View>
      <View style={s.cameraBottom}>{previous && <View><Text style={s.opacityLabel}>이전 사진 투명도</Text><View style={s.opacityRow}>{[.25,.45,.65,.85].map(x => <Pressable key={x} onPress={() => setOpacity(x)} style={[s.opacity, opacity === x && { backgroundColor: c.blue }]}><Text style={s.opacityText}>{Math.round(x*100)}</Text></Pressable>)}</View></View>}
        <View style={s.captureRow}><Pressable disabled={busy || countdown !== null} onPress={pick} style={s.cameraAction}><Text style={s.cameraActionIcon}>▧</Text><Text style={s.cameraActionText}>가져오기</Text></Pressable><Pressable disabled={busy || countdown !== null} onPress={capture} style={s.shutter}><View style={s.shutterIn}>{busy && <ActivityIndicator color="#fff"/>}</View></Pressable><Pressable disabled={busy || countdown !== null} onPress={startTimer} style={s.cameraAction}><Text style={s.cameraActionIcon}>3s</Text><Text style={s.cameraActionText}>타이머</Text></Pressable></View>
      </View>
    </View>
  </View>;
}
function Grid() { return <View pointerEvents="none" style={StyleSheet.absoluteFill}><View style={[s.vline,{left:'33.3%'}]}/><View style={[s.vline,{left:'66.6%'}]}/><View style={[s.hline,{top:'33.3%'}]}/><View style={[s.hline,{top:'66.6%'}]}/></View>; }

function Compare({ project, back }: { project: Project; back: () => void }) {
  const [leftIndex,setLeftIndex]=useState(0); const [rightIndex,setRightIndex]=useState(project.photos.length-1); const [target,setTarget]=useState<'left'|'right'>('right'); const [mode, setMode] = useState<'side'|'overlay'>('side');
  const first=project.photos[leftIndex],last=project.photos[rightIndex];
  const choose=(index:number)=>{if(target==='left'){setLeftIndex(index);setTarget('right');}else setRightIndex(index);};
  return <SafeAreaView style={s.safe}><Header title="사진 비교" back={back}/><ScrollView contentContainerStyle={s.comparePage}>
    <View style={s.compareSlots}><PickerSlot label="왼쪽" photo={first} active={target==='left'} onPress={()=>setTarget('left')}/><View style={s.compareArrow}><Text style={s.compareArrowText}>↔</Text></View><PickerSlot label="오른쪽" photo={last} active={target==='right'} onPress={()=>setTarget('right')}/></View>
    <Text style={s.pickerGuide}>{target==='left'?'왼쪽':'오른쪽'}에 표시할 사진을 선택하세요</Text><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.photoPicker}>{project.photos.map((p,i)=><Pressable key={p.id} onPress={()=>choose(i)} style={[s.photoPick,(i===leftIndex||i===rightIndex)&&s.photoPickOn]}><Image source={{uri:p.uri}} style={s.photoPickImage}/><Text style={s.photoPickText}>{i+1}</Text></Pressable>)}</ScrollView>
    <View style={s.segment}><Pressable onPress={() => setMode('side')} style={[s.segmentItem, mode === 'side' && s.segmentOn]}><Text style={s.segmentText}>나란히</Text></Pressable><Pressable onPress={() => setMode('overlay')} style={[s.segmentItem, mode === 'overlay' && s.segmentOn]}><Text style={s.segmentText}>겹쳐보기</Text></Pressable></View>
    <View style={s.compareFrame}>{mode === 'side' ? <View style={{flex:1,flexDirection:'row'}}><Image source={{uri:first.uri}} style={s.compareHalf}/><Image source={{uri:last.uri}} style={s.compareHalf}/><View style={s.compareLine}/></View> : <View style={{flex:1}}><Image source={{uri:first.uri}} style={StyleSheet.absoluteFill}/><Image source={{uri:last.uri}} style={[StyleSheet.absoluteFill,{opacity:.5}]}/></View>}<DateBadge text={fmt(first.createdAt)} left/><DateBadge text={fmt(last.createdAt)}/></View>
    <View style={s.summary}><Text style={s.summaryTitle}>{Math.abs(Math.round((new Date(last.createdAt).getTime()-new Date(first.createdAt).getTime())/86400000))}일의 변화</Text><Text style={s.meta}>원하는 두 순간을 비교하고 있어요.</Text></View>
  </ScrollView></SafeAreaView>;
}
function PickerSlot({label,photo,active,onPress}:{label:string;photo:ProgressPhoto;active:boolean;onPress:()=>void}) { return <Pressable onPress={onPress} style={[s.pickerSlot,active&&s.pickerSlotOn]}><Image source={{uri:photo.uri}} style={s.pickerSlotImage}/><View><Text style={s.pickerSlotLabel}>{label}</Text><Text style={s.pickerSlotDate}>{fmt(photo.createdAt)}</Text></View></Pressable>; }
function DateBadge({text,left}:{text:string;left?:boolean}) { return <View style={[s.badge,left?{left:10}:{right:10}]}><Text style={s.badgeText}>{text}</Text></View>; }

async function waitForActiveApp() {
  const deadline = Date.now() + 15000;
  while (AppState.currentState !== 'active') {
    if (Date.now() > deadline) throw new Error('앱으로 돌아온 뒤 다시 시도해주세요. 광고 시청 보상은 이 화면에서 유지돼요.');
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  // Let the full-screen ad dismissal finish before starting the encoder.
  await new Promise(resolve => setTimeout(resolve, 500));
}

function Playback({project,back}:{project:Project;back:()=>void}) {
  const [index,setIndex]=useState(0); const [playing,setPlaying]=useState(true); const [speed,setSpeed]=useState(900); const [transition,setTransition]=useState<'cut'|'smooth'>('smooth');
  const [aspectRatio,setAspectRatio]=useState<'9:16'|'4:5'|'1:1'>('9:16');
  const [exporting,setExporting]=useState(false); const [exportProgress,setExportProgress]=useState(0); const [adLoading,setAdLoading]=useState(false); const [exportQuality,setExportQuality]=useState<'1080p'|'4k'>('1080p');
  const exportBusy = useRef(false); const adBusy = useRef(false);
  const [adPhase,setAdPhase]=useState<'loading'|'showing'|'rewarded'|'closed'>('loading');
  const rewardCredit = useRef(false); const [hasRewardCredit,setHasRewardCredit] = useState(false);
  const [currentUri,setCurrentUri]=useState(project.photos[0].uri); const [nextUri,setNextUri]=useState(project.photos[0].uri); const fade=useRef(new Animated.Value(0)).current;
  const show=(next:number,animate=true)=>{const uri=project.photos[next].uri;if(transition==='cut'||!animate){fade.stopAnimation();fade.setValue(0);setCurrentUri(uri);setNextUri(uri);setIndex(next);return;}setNextUri(uri);fade.setValue(0);setIndex(next);Animated.timing(fade,{toValue:1,duration:Math.min(650,speed*.65),useNativeDriver:true}).start(({finished})=>{if(finished){setCurrentUri(uri);fade.setValue(0);}});};
  useEffect(()=>{if(!playing)return;if(index>=project.photos.length-1){setPlaying(false);return;}const timer=setTimeout(()=>{const next=index+1,uri=project.photos[next].uri;if(transition==='cut'){setCurrentUri(uri);setNextUri(uri);}else{setNextUri(uri);fade.setValue(0);Animated.timing(fade,{toValue:1,duration:Math.min(650,speed*.65),useNativeDriver:true}).start(({finished})=>{if(finished){setCurrentUri(uri);fade.setValue(0);}});}setIndex(next);},speed);return()=>clearTimeout(timer);},[playing,index,speed,transition,project.photos,fade]);
  const restart=()=>{if(playing){setPlaying(false);return;}if(index>=project.photos.length-1)show(0,false);setPlaying(true);};
  const saveResult=async(uri:string)=>{try{await saveVideoToLibrary(uri);Alert.alert('저장 완료','사진 앱에서 확인할 수 있어요.');}catch(e){Alert.alert('저장하지 못했어요',e instanceof Error?e.message:'다시 시도해주세요.');}};
  const shareResult=async(uri:string)=>{try{await shareVideo(uri);}catch(e){Alert.alert('공유하지 못했어요',e instanceof Error?e.message:'다시 시도해주세요.');}};
  const exportVideo=async(quality:'1080p'|'4k')=>{
    if(exportBusy.current || adBusy.current) return;
    exportBusy.current=true;
    setPlaying(false); setAdLoading(false); setExportQuality(quality); setExporting(true); setExportProgress(0);
    try {
      await waitForActiveApp();
      console.info('[FrameLoop/export] start', {quality, aspectRatio, photoCount:project.photos.length});
      const uri=await createTimelapse(project,{transition,frameDurationMs:speed,aspectRatio,quality},setExportProgress);
      if(quality==='4k'){rewardCredit.current=false;setHasRewardCredit(false);}
      console.info('[FrameLoop/export] completed', {quality});
      Alert.alert('변화 영상이 완성됐어요',`${quality==='4k'?'4K':'1080p'} · ${aspectRatio} 비율로 만들었어요. 사진 앱에 저장하거나 바로 공유할 수 있어요.`,[{text:'닫기',style:'cancel'},{text:'사진 앱에 저장',onPress:()=>saveResult(uri)},{text:'공유',onPress:()=>shareResult(uri)}]);
    } catch(e) {
      console.error('[FrameLoop/export] failed', e);
      const detail=e instanceof Error?e.message:'잠시 후 다시 시도해주세요.';
      Alert.alert('영상을 만들지 못했어요',detail+(quality==='4k'&&rewardCredit.current?'\n광고 시청 보상은 유지돼요. 이 화면에서 광고 없이 4K 만들기를 다시 시도할 수 있어요.':''));
    } finally {exportBusy.current=false;setExporting(false);}
  };
  const unlock4K=async()=>{
    if(exportBusy.current||adBusy.current)return;
    if(rewardCredit.current){await exportVideo('4k');return;}
    adBusy.current=true;setPlaying(false);setAdPhase('loading');setAdLoading(true);
    let earned=false;
    try {
      const { watchRewardedAdFor4K }=await import('./rewardedAds');
      const result=await watchRewardedAdFor4K(setAdPhase);
      earned=result==='earned';
      if(earned){rewardCredit.current=true;setHasRewardCredit(true);}
      else if(result==='closed')Alert.alert('4K 저장이 잠겨 있어요','광고를 끝까지 확인하면 4K 영상을 한 번 만들 수 있어요.');
      else Alert.alert('광고를 준비하지 못했어요','잠시 후 다시 시도하거나 1080p로 저장해주세요.');
    } catch(e) {
      console.error('[FrameLoop/ads] failed', e);
      Alert.alert('광고를 준비하지 못했어요','잠시 후 다시 시도하거나 1080p로 저장해주세요.');
    } finally {adBusy.current=false;setAdLoading(false);}
    if(earned)await exportVideo('4k');
  };
  const photo=project.photos[index];
  return <SafeAreaView style={s.playbackPage}><StatusBar style="light"/><View style={s.playbackTop}><Pressable disabled={exporting||adLoading} onPress={back} style={s.playbackClose}><Text style={s.playbackCloseText}>×</Text></Pressable><Text style={s.playbackTitle}>{project.title}</Text><View style={{width:42}}/></View>
    <View style={s.playbackCanvas}><Image source={{uri:currentUri}} style={StyleSheet.absoluteFill} resizeMode="cover"/><Animated.Image source={{uri:nextUri}} style={[StyleSheet.absoluteFill,{opacity:fade}]} resizeMode="cover"/><View style={s.playbackShade}/><View style={s.playbackInfo}><Text style={s.playbackCount}>{index+1} / {project.photos.length}</Text><Text style={s.playbackDate}>{fmt(photo.createdAt)}</Text></View></View>
    <View style={s.playbackPanel}><View style={s.progressTrack}><View style={[s.progressFill,{width:`${((index+1)/project.photos.length)*100}%`}]}/></View><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.playThumbs}>{project.photos.map((p,i)=><Pressable key={p.id} onPress={()=>show(i,false)}><Image source={{uri:p.uri}} style={[s.playThumb,i===index&&s.playThumbOn]}/></Pressable>)}</ScrollView>
      <Text style={s.controlLabel}>전환 방식</Text><View style={s.segmentDark}><Pressable onPress={()=>setTransition('cut')} style={[s.segmentDarkItem,transition==='cut'&&s.segmentDarkOn]}><Text style={s.segmentDarkText}>기본</Text></Pressable><Pressable onPress={()=>setTransition('smooth')} style={[s.segmentDarkItem,transition==='smooth'&&s.segmentDarkOn]}><Text style={s.segmentDarkText}>부드럽게</Text></Pressable></View>
      <View style={s.playControls}><Pressable onPress={()=>show(Math.max(0,index-1),false)} style={s.playSide}><Text style={s.playSideText}>‹</Text></Pressable><Pressable onPress={restart} style={s.playMain}><Text style={s.playMainText}>{playing?'Ⅱ':'▶'}</Text></Pressable><Pressable onPress={()=>show(Math.min(project.photos.length-1,index+1),false)} style={s.playSide}><Text style={s.playSideText}>›</Text></Pressable></View>
      <View style={s.speedRow}>{[{v:1400,l:'느리게'},{v:900,l:'보통'},{v:500,l:'빠르게'}].map(x=><Pressable key={x.v} onPress={()=>setSpeed(x.v)} style={[s.speed,x.v===speed&&s.speedOn]}><Text style={[s.speedText,x.v===speed&&{color:'#fff'}]}>{x.l}</Text></Pressable>)}</View>
      <Text style={[s.controlLabel,s.exportRatioLabel]}>저장 비율</Text><View style={s.segmentDark}>{(['9:16','4:5','1:1'] as const).map(x=><Pressable key={x} onPress={()=>setAspectRatio(x)} style={[s.segmentDarkItem,aspectRatio===x&&s.segmentDarkOn]}><Text style={s.segmentDarkText}>{x}</Text></Pressable>)}</View>
      <Pressable disabled={exporting||adLoading} onPress={()=>exportVideo('1080p')} style={({pressed})=>[s.exportButton,(pressed||exporting||adLoading)&&{opacity:.72}]}>{exporting&&exportQuality==='1080p'?<><ActivityIndicator color="#fff"/><Text style={s.exportText}>1080p 만드는 중 · {Math.round(exportProgress*100)}%</Text></>:<Text style={s.exportText}>1080p · {aspectRatio} 무료로 만들기</Text>}</Pressable>
      <Pressable disabled={exporting||adLoading} onPress={unlock4K} style={({pressed})=>[s.rewardButton,(pressed||exporting||adLoading)&&{opacity:.65}]}>{exporting&&exportQuality==='4k'?<><ActivityIndicator color="#fff"/><Text style={s.rewardText}>{exportProgress>=1?'4K 영상 마무리 중…':`4K 영상 만드는 중 · ${Math.round(exportProgress*100)}%`}</Text></>:adLoading?<><ActivityIndicator color="#fff"/><Text style={s.rewardText}>{adPhase==='loading'?'광고 불러오는 중…':adPhase==='showing'?'광고 시청 완료 확인 중…':'광고 시청 완료 · 영상 생성 준비 중…'}</Text></>:<><Text style={s.rewardIcon}>▶</Text><Text style={s.rewardText}>{hasRewardCredit?'광고 없이 4K 다시 만들기':`광고 보고 4K · ${aspectRatio} 만들기`}</Text></>}</Pressable>
      <Text style={s.localExportHint}>광고는 4K를 선택할 때만 표시돼요. 사진은 서버로 전송되지 않아요.</Text>
    </View>
  </SafeAreaView>;
}

function Library({projects,go}:{projects:Project[];go:(x:Screen)=>void}) {
  const photoCount = projects.reduce((sum,project)=>sum+project.photos.length,0);
  return <SafeAreaView style={s.safe}><ScrollView contentContainerStyle={s.page} showsVerticalScrollIndicator={false}><Text style={s.eyebrow}>ALL RECORDS</Text><Text style={s.title}>보관함</Text><Text style={s.librarySummary}>프로젝트 {projects.length}개 · 사진 {photoCount}장</Text>
    <View style={s.libraryProjects}>{projects.map(project=>{const cover=project.photos.at(-1);const cat=cats.find(x=>x.key===project.category);return <Pressable key={project.id} onPress={()=>go({name:'project',projectId:project.id})} style={({pressed})=>[s.libraryProject,pressed&&s.pressed]}>
      {cover?<Image source={{uri:cover.uri}} style={s.libraryProjectImage}/>:<View style={[s.libraryProjectImage,s.libraryProjectEmpty]}><Text style={s.libraryProjectEmptyIcon}>{cat?.icon}</Text></View>}
      <View style={s.libraryProjectShade}/><View style={s.libraryProjectCopy}><Text numberOfLines={1} style={s.libraryProjectTitle}>{project.title}</Text><Text style={s.libraryProjectMeta}>{days(project.createdAt)}일째 · 사진 {project.photos.length}장</Text></View><Text style={s.libraryProjectArrow}>›</Text>
    </Pressable>})}</View>
    {!projects.length&&<View style={s.empty}><EmptyArt/><Text style={s.emptyTitle}>아직 보관된 프로젝트가 없어요</Text><Text style={s.emptyCopy}>첫 프로젝트를 만들면 이곳에서 기록별로 모아볼 수 있어요.</Text><Button label="새 프로젝트 만들기" onPress={()=>go({name:'create'})}/></View>}
  </ScrollView><BottomNav active="library" go={go}/></SafeAreaView>;
}

export default function FrameLoopApp() {
  const [projects,setProjects]=useState<Project[]>([]); const [screen,setScreen]=useState<Screen>({name:'home'}); const [loading,setLoading]=useState(true);
  useEffect(()=>{loadProjects().then(setProjects).finally(()=>setLoading(false));},[]);
  useEffect(()=>{if(!loading) saveProjects(projects);},[projects,loading]);
  const project=useMemo(()=>'projectId' in screen?projects.find(x=>x.id===screen.projectId):undefined,[projects,screen]);
  const add=(id:string,photo:ProgressPhoto)=>{setProjects(xs=>xs.map(x=>x.id===id?{...x,photos:[...x.photos,photo]}:x));setScreen({name:'project',projectId:id});};
  if(loading)return <View style={[s.safe,s.center]}><ActivityIndicator size="large" color={c.blue}/></View>;
  let body:React.ReactNode;
  if(screen.name==='home')body=<Home projects={projects} go={setScreen} onImported={setProjects}/>;
  else if(screen.name==='create')body=<Create back={()=>setScreen({name:'home'})} create={p=>{setProjects(x=>[p,...x]);setScreen({name:'camera',projectId:p.id});}}/>;
  else if(screen.name==='library')body=<Library projects={projects} go={setScreen}/>;
  else if(screen.name==='project'&&project)body=<ProjectView project={project} go={setScreen} remove={()=>{setProjects(x=>x.filter(y=>y.id!==project.id));setScreen({name:'home'});}}/>;
  else if(screen.name==='camera'&&project)body=<Camera project={project} back={()=>setScreen({name:'project',projectId:project.id})} add={p=>add(project.id,p)}/>;
  else if(screen.name==='compare'&&project&&project.photos.length>1)body=<Compare project={project} back={()=>setScreen({name:'project',projectId:project.id})}/>;
  else if(screen.name==='playback'&&project&&project.photos.length>1)body=<Playback project={project} back={()=>setScreen({name:'project',projectId:project.id})}/>;
  else body=<Home projects={projects} go={setScreen} onImported={setProjects}/>;
  return <View style={{flex:1,backgroundColor:c.bg}}><StatusBar style="dark"/>{body}</View>;
}

const s=StyleSheet.create({
  safe:{flex:1,backgroundColor:c.bg,paddingTop:Platform.OS==='android'?RNStatusBar.currentHeight:0},center:{alignItems:'center',justifyContent:'center'},page:{padding:20,paddingTop:16,paddingBottom:126},homeTop:{height:54,flexDirection:'row',alignItems:'center',justifyContent:'space-between'},brand:{fontSize:21,fontWeight:'900',color:c.text,letterSpacing:-.7},topIcon:{width:40,height:40,borderRadius:20,backgroundColor:c.card,alignItems:'center',justifyContent:'center',borderWidth:1,borderColor:c.line},topIconText:{fontSize:14,fontWeight:'900',letterSpacing:1.5,color:c.text},hero:{paddingTop:21},eyebrow:{color:c.blue,fontSize:12,fontWeight:'800',letterSpacing:1.8,marginBottom:6},title:{color:c.text,fontSize:32,lineHeight:38,fontWeight:'900',letterSpacing:-1.2},homeSub:{color:c.muted,fontSize:14,marginTop:6},plus:{width:46,height:46,borderRadius:23,backgroundColor:c.blue,alignItems:'center',justifyContent:'center'},plusText:{color:'#fff',fontSize:29,fontWeight:'300'},chips:{gap:8,paddingVertical:20},chip:{paddingHorizontal:16,paddingVertical:9,backgroundColor:c.card,borderRadius:99,borderWidth:1,borderColor:c.line},chipOn:{backgroundColor:c.blueSoft,borderColor:'#C8D7FF'},chipText:{color:c.muted,fontWeight:'700'},chipTextOn:{color:c.blue},pressed:{opacity:.76,transform:[{scale:.99}]},
  empty:{padding:26,marginTop:10,backgroundColor:c.card,borderRadius:26,alignItems:'center',borderWidth:1,borderColor:c.line},art:{width:160,height:128},artBack:{position:'absolute',width:108,height:88,borderRadius:18,borderWidth:2,borderColor:'#C9D5ED',backgroundColor:'#F5F8FF',right:0,top:9,transform:[{rotate:'7deg'}]},artFront:{position:'absolute',width:112,height:94,borderRadius:18,borderWidth:2,borderColor:c.blue,backgroundColor:'#F0F4FF',left:10,top:20,overflow:'hidden'},sun:{width:18,height:18,borderRadius:9,backgroundColor:'#F5BD55',left:20,top:18},hill:{position:'absolute',width:130,height:70,borderRadius:70,backgroundColor:'#86B99C',left:18,bottom:-26,transform:[{rotate:'-8deg'}]},emptyTitle:{color:c.text,fontSize:20,fontWeight:'800',textAlign:'center'},emptyCopy:{color:c.muted,lineHeight:21,textAlign:'center',marginTop:8,marginBottom:22},
  button:{minHeight:54,borderRadius:15,backgroundColor:c.blue,alignItems:'center',justifyContent:'center',paddingHorizontal:22,width:'100%'},buttonSecondary:{backgroundColor:c.blueSoft},buttonText:{color:'#fff',fontSize:16,fontWeight:'800'},card:{flexDirection:'row',alignItems:'center',backgroundColor:c.card,padding:10,borderRadius:18,borderWidth:1,borderColor:c.line,shadowColor:'#18213A',shadowOpacity:.035,shadowRadius:9,shadowOffset:{width:0,height:4}},thumb:{width:94,height:104,borderRadius:13,backgroundColor:'#E9E5DD'},thumbEmpty:{alignItems:'center',justifyContent:'center',backgroundColor:c.blueSoft},thumbIcon:{fontSize:32,color:c.blue},cardCopy:{flex:1,paddingLeft:14},cardTitle:{color:c.text,fontSize:17,fontWeight:'800'},meta:{color:c.muted,marginTop:5},cardProgress:{height:5,borderRadius:3,backgroundColor:'#EDF0F5',overflow:'hidden',marginTop:14},cardProgressFill:{height:'100%',borderRadius:3,backgroundColor:c.blue},cardHint:{fontSize:12,color:c.blue,fontWeight:'800',marginTop:7},smallButton:{backgroundColor:c.blue,paddingVertical:10,paddingHorizontal:13,borderRadius:12,alignSelf:'flex-start',marginTop:14},smallButtonText:{color:'#fff',fontSize:13,fontWeight:'800'},chev:{color:'#A2A6B0',fontSize:27,marginHorizontal:6},
  nav:{position:'absolute',left:0,right:0,bottom:0,height:Platform.OS==='ios'?94:78,paddingBottom:Platform.OS==='ios'?16:4,backgroundColor:'#FFFFFF',borderTopWidth:1,borderTopColor:c.line,flexDirection:'row',alignItems:'center',justifyContent:'space-around',shadowColor:'#111827',shadowOpacity:.08,shadowRadius:16,shadowOffset:{width:0,height:-5}},navItem:{alignItems:'center',justifyContent:'center',minWidth:84,height:68},navAdd:{marginTop:-22},navIconBox:{width:32,height:32,alignItems:'center',justifyContent:'center'},navAddIcon:{width:54,height:54,borderRadius:27,backgroundColor:c.blue,shadowColor:c.blue,shadowOpacity:.3,shadowRadius:10,shadowOffset:{width:0,height:5}},navIcon:{width:32,height:32,textAlign:'center',lineHeight:32,color:'#9499A5',fontSize:23,fontWeight:'700'},navHomeIcon:{fontSize:30,lineHeight:31},navLibraryIcon:{fontSize:24,lineHeight:31},navCameraIcon:{color:'#fff',fontSize:28,lineHeight:32},navText:{color:'#9499A5',fontSize:11,fontWeight:'700',marginTop:4},navOn:{color:c.blue},
  header:{height:58,flexDirection:'row',alignItems:'center',paddingHorizontal:14},headerSide:{width:54},headerTitle:{flex:1,textAlign:'center',color:c.text,fontSize:17,fontWeight:'800'},back:{color:c.text,fontSize:38,lineHeight:40},more:{color:c.text,fontSize:18,fontWeight:'800',letterSpacing:2},form:{padding:20,paddingBottom:50},formIntro:{color:c.text,fontSize:25,lineHeight:33,fontWeight:'800',marginBottom:16},label:{color:c.text,fontSize:14,fontWeight:'800',marginTop:20,marginBottom:10},input:{height:58,borderWidth:1,borderColor:c.line,borderRadius:14,paddingHorizontal:16,backgroundColor:'#fff',color:c.text,fontSize:16},catGrid:{flexDirection:'row',flexWrap:'wrap',gap:9},cat:{width:'31%',minHeight:76,backgroundColor:'#fff',borderWidth:1,borderColor:c.line,borderRadius:14,alignItems:'center',justifyContent:'center'},catOn:{borderColor:c.blue,backgroundColor:c.blueSoft},catIcon:{fontSize:22,color:c.muted},catText:{color:c.muted,fontSize:13,fontWeight:'700',marginTop:5},blue:{color:c.blue},reminders:{flexDirection:'row',flexWrap:'wrap',gap:8},reminder:{paddingVertical:11,paddingHorizontal:15,borderRadius:12,backgroundColor:'#fff',borderWidth:1,borderColor:c.line},reminderOn:{backgroundColor:c.blue,borderColor:c.blue},reminderText:{color:c.muted,fontWeight:'700'},privacy:{color:c.muted,fontSize:12,textAlign:'center',marginTop:15},
  projectPage:{padding:20,paddingBottom:50},stats:{backgroundColor:'#fff',borderRadius:20,padding:19,flexDirection:'row',alignItems:'center',justifyContent:'space-around',marginBottom:14,borderWidth:1,borderColor:c.line},statValue:{color:c.text,fontSize:18,fontWeight:'800',textAlign:'center'},statLabel:{color:c.muted,fontSize:11,fontWeight:'600',marginTop:5,textAlign:'center'},divider:{width:1,height:30,backgroundColor:c.line},sectionHead:{flexDirection:'row',justifyContent:'space-between',alignItems:'center',marginTop:30,marginBottom:14},sectionTitle:{color:c.text,fontSize:19,fontWeight:'800'},link:{color:c.blue,fontWeight:'800'},timelineEmpty:{backgroundColor:'#fff',borderRadius:20,padding:26,alignItems:'center',borderWidth:1,borderColor:c.line},timelineIcon:{color:c.blue,fontSize:38},timelineTitle:{color:c.text,fontSize:17,fontWeight:'800',marginTop:8},timelineCopy:{color:c.muted,textAlign:'center',lineHeight:20,marginTop:7},timelineRow:{minHeight:132,flexDirection:'row'},rail:{width:30,alignItems:'center'},dot:{width:13,height:13,borderRadius:7,backgroundColor:c.blue,marginTop:14,zIndex:2},line:{position:'absolute',width:2,backgroundColor:'#B8CDFD',top:25,bottom:-10},timelineImage:{width:104,height:118,borderRadius:16,backgroundColor:'#E9E5DD'},timelineWords:{flex:1,padding:15},timelineDate:{color:c.text,fontSize:15,fontWeight:'800'},
  permission:{flex:1,backgroundColor:c.bg,padding:26,justifyContent:'center',alignItems:'center'},permissionIcon:{fontSize:64,color:c.blue},permissionTitle:{color:c.text,fontSize:24,fontWeight:'800',marginTop:20},permissionCopy:{color:c.muted,textAlign:'center',lineHeight:22,marginVertical:12,marginBottom:26},importLink:{color:c.blue,fontWeight:'800',marginTop:22},cancel:{color:c.muted,marginTop:20},cameraPage:{flex:1,backgroundColor:'#000'},cameraPreview:{position:'absolute',left:0,right:0,top:0,bottom:0,zIndex:0},cameraOverlay:{position:'absolute',left:0,right:0,top:0,bottom:0,zIndex:2,elevation:2},countdown:{position:'absolute',zIndex:4,left:0,right:0,top:'35%',alignItems:'center',justifyContent:'center'},countdownText:{color:'#fff',fontSize:96,lineHeight:106,fontWeight:'900',textShadowColor:'rgba(0,0,0,.55)',textShadowRadius:14,textShadowOffset:{width:0,height:3}},vline:{position:'absolute',top:0,bottom:0,width:1,backgroundColor:'rgba(255,255,255,.35)'},hline:{position:'absolute',left:0,right:0,height:1,backgroundColor:'rgba(255,255,255,.35)'},cameraTop:{position:'absolute',zIndex:3,left:0,right:0,top:Platform.OS==='ios'?52:24,flexDirection:'row',alignItems:'center',justifyContent:'space-between',paddingHorizontal:16},round:{width:42,height:42,borderRadius:21,backgroundColor:'rgba(0,0,0,.45)',alignItems:'center',justifyContent:'center'},roundText:{color:'#fff',fontSize:26},cameraTitle:{color:'#fff',fontSize:14,fontWeight:'800',backgroundColor:'rgba(0,0,0,.45)',paddingVertical:9,paddingHorizontal:14,borderRadius:99,overflow:'hidden'},cameraBottom:{position:'absolute',zIndex:3,left:0,right:0,bottom:0,backgroundColor:'rgba(11,13,18,.82)',paddingTop:14,paddingBottom:Platform.OS==='ios'?34:20,paddingHorizontal:20},opacityLabel:{color:'#fff',fontSize:12,fontWeight:'700',marginBottom:8,textAlign:'center'},opacityRow:{flexDirection:'row',justifyContent:'center',gap:8},opacity:{width:38,height:28,borderRadius:10,backgroundColor:'rgba(255,255,255,.16)',alignItems:'center',justifyContent:'center'},opacityText:{color:'#fff',fontSize:11,fontWeight:'800'},captureRow:{height:94,flexDirection:'row',alignItems:'center',justifyContent:'space-between'},shutter:{width:76,height:76,borderRadius:38,borderWidth:4,borderColor:'#fff',alignItems:'center',justifyContent:'center'},shutterIn:{width:62,height:62,borderRadius:31,backgroundColor:c.blue,alignItems:'center',justifyContent:'center'},cameraAction:{width:72,alignItems:'center'},cameraActionIcon:{color:'#fff',fontSize:20,fontWeight:'700'},cameraActionText:{color:'rgba(255,255,255,.75)',fontSize:11,marginTop:5},
  comparePage:{padding:20,paddingBottom:50},segment:{flexDirection:'row',padding:4,borderRadius:14,backgroundColor:'#EBE7DF',marginBottom:18},segmentItem:{flex:1,paddingVertical:11,alignItems:'center',borderRadius:11},segmentOn:{backgroundColor:'#fff'},segmentText:{color:c.text,fontWeight:'700'},compareFrame:{height:430,borderRadius:22,overflow:'hidden',backgroundColor:'#DED9D0'},compareHalf:{width:'50%',height:'100%',resizeMode:'cover'},compareLine:{position:'absolute',left:'50%',top:0,bottom:0,width:2,backgroundColor:'#fff'},badge:{position:'absolute',top:10,backgroundColor:'rgba(0,0,0,.58)',paddingHorizontal:9,paddingVertical:6,borderRadius:9},badgeText:{color:'#fff',fontSize:11,fontWeight:'700'},summary:{alignItems:'center',paddingVertical:22},summaryTitle:{color:c.text,fontSize:21,fontWeight:'800'},ratios:{flexDirection:'row',gap:10,marginVertical:14},ratio:{flex:1,height:90,borderWidth:1,borderColor:c.line,backgroundColor:'#fff',borderRadius:15,alignItems:'center',justifyContent:'center'},ratioOn:{borderColor:c.blue,backgroundColor:c.blueSoft},ratioShape:{width:25,height:25,borderWidth:2,borderColor:c.text,borderRadius:3},ratioText:{color:c.text,fontSize:12,fontWeight:'800',marginTop:7},
  librarySummary:{color:c.muted,marginTop:10,marginBottom:24},libraryProjects:{gap:13},libraryProject:{height:178,borderRadius:21,overflow:'hidden',backgroundColor:'#DDE2EA',borderWidth:1,borderColor:c.line},libraryProjectImage:{width:'100%',height:'100%',resizeMode:'cover'},libraryProjectEmpty:{alignItems:'center',justifyContent:'center',backgroundColor:c.blueSoft},libraryProjectEmptyIcon:{fontSize:46,color:c.blue},libraryProjectShade:{position:'absolute',left:0,right:0,top:0,bottom:0,backgroundColor:'rgba(7,12,25,.22)'},libraryProjectCopy:{position:'absolute',left:17,right:50,bottom:16},libraryProjectTitle:{color:'#fff',fontSize:20,fontWeight:'900'},libraryProjectMeta:{color:'rgba(255,255,255,.82)',fontSize:12,fontWeight:'700',marginTop:5},libraryProjectArrow:{position:'absolute',right:18,bottom:16,color:'#fff',fontSize:32,lineHeight:32},
  projectCover:{height:220,borderRadius:20,overflow:'hidden',marginBottom:14,backgroundColor:'#DDE2EA'},projectCoverImage:{width:'100%',height:'100%',resizeMode:'cover'},projectCoverShade:{position:'absolute',left:0,right:0,top:0,bottom:0,backgroundColor:'rgba(0,0,0,.2)'},projectCoverCopy:{position:'absolute',left:18,right:18,bottom:17},projectCoverKicker:{color:'rgba(255,255,255,.8)',fontSize:11,fontWeight:'900',letterSpacing:1.5},projectCoverTitle:{color:'#fff',fontSize:25,fontWeight:'900',marginTop:3},projectCoverMeta:{color:'rgba(255,255,255,.82)',fontSize:12,marginTop:4},quickActions:{flexDirection:'row',gap:9,marginTop:2},quickAction:{flex:1,height:74,borderRadius:16,backgroundColor:c.card,borderWidth:1,borderColor:c.line,alignItems:'center',justifyContent:'center'},quickActionPrimary:{backgroundColor:c.blue,borderColor:c.blue},quickIcon:{color:c.text,fontSize:21,fontWeight:'800'},quickLabel:{color:c.text,fontSize:12,fontWeight:'800',marginTop:5},sectionCount:{color:c.muted,fontSize:13,fontWeight:'700'},
  compareSlots:{flexDirection:'row',alignItems:'center',gap:8},pickerSlot:{flex:1,backgroundColor:c.card,borderWidth:1,borderColor:c.line,borderRadius:15,padding:7,flexDirection:'row',alignItems:'center',gap:9},pickerSlotOn:{borderColor:c.blue,backgroundColor:c.blueSoft},pickerSlotImage:{width:44,height:54,borderRadius:9,backgroundColor:'#E5E7EB'},pickerSlotLabel:{color:c.text,fontSize:12,fontWeight:'900'},pickerSlotDate:{color:c.muted,fontSize:10,marginTop:3},compareArrow:{width:24,alignItems:'center'},compareArrowText:{color:c.muted,fontSize:16,fontWeight:'800'},pickerGuide:{color:c.muted,fontSize:12,textAlign:'center',marginTop:16},photoPicker:{gap:8,paddingVertical:12},photoPick:{width:52,height:66,borderRadius:11,borderWidth:2,borderColor:'transparent',overflow:'hidden'},photoPickOn:{borderColor:c.blue},photoPickImage:{width:'100%',height:'100%',resizeMode:'cover'},photoPickText:{position:'absolute',right:3,bottom:3,minWidth:18,height:18,borderRadius:9,backgroundColor:'rgba(0,0,0,.62)',color:'#fff',fontSize:10,fontWeight:'800',textAlign:'center',lineHeight:18},
  playbackPage:{flex:1,backgroundColor:'#0B0D12',paddingTop:Platform.OS==='android'?RNStatusBar.currentHeight:0},playbackTop:{height:62,flexDirection:'row',alignItems:'center',justifyContent:'space-between',paddingHorizontal:16},playbackClose:{width:42,height:42,borderRadius:21,backgroundColor:'rgba(255,255,255,.1)',alignItems:'center',justifyContent:'center'},playbackCloseText:{color:'#fff',fontSize:28,lineHeight:30},playbackTitle:{color:'#fff',fontSize:16,fontWeight:'800'},playbackCanvas:{flex:1,marginHorizontal:14,borderRadius:22,overflow:'hidden',backgroundColor:'#20232A'},playbackShade:{position:'absolute',left:0,right:0,bottom:0,height:120,backgroundColor:'rgba(0,0,0,.22)'},playbackInfo:{position:'absolute',left:16,right:16,bottom:15,flexDirection:'row',alignItems:'center',justifyContent:'space-between'},playbackCount:{color:'#fff',fontSize:13,fontWeight:'900',backgroundColor:'rgba(0,0,0,.5)',paddingHorizontal:10,paddingVertical:6,borderRadius:12,overflow:'hidden'},playbackDate:{color:'#fff',fontSize:13,fontWeight:'800'},playbackPanel:{paddingHorizontal:18,paddingTop:16,paddingBottom:Platform.OS==='ios'?24:16},progressTrack:{height:4,borderRadius:2,backgroundColor:'rgba(255,255,255,.18)',overflow:'hidden'},progressFill:{height:'100%',borderRadius:2,backgroundColor:c.blue},playThumbs:{gap:7,paddingVertical:12},playThumb:{width:38,height:48,borderRadius:8,borderWidth:2,borderColor:'transparent'},playThumbOn:{borderColor:c.blue},controlLabel:{color:'rgba(255,255,255,.62)',fontSize:11,fontWeight:'800',marginBottom:7},segmentDark:{height:42,flexDirection:'row',borderRadius:12,backgroundColor:'rgba(255,255,255,.09)',padding:3},segmentDarkItem:{flex:1,alignItems:'center',justifyContent:'center',borderRadius:9},segmentDarkOn:{backgroundColor:'rgba(255,255,255,.15)'},segmentDarkText:{color:'#fff',fontSize:12,fontWeight:'800'},playControls:{height:70,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:28},playSide:{width:42,height:42,borderRadius:21,backgroundColor:'rgba(255,255,255,.08)',alignItems:'center',justifyContent:'center'},playSideText:{color:'#fff',fontSize:30,lineHeight:32},playMain:{width:58,height:58,borderRadius:29,backgroundColor:'#fff',alignItems:'center',justifyContent:'center'},playMainText:{color:'#0B0D12',fontSize:21,fontWeight:'900'},speedRow:{flexDirection:'row',justifyContent:'center',gap:7},speed:{paddingHorizontal:15,paddingVertical:8,borderRadius:99,backgroundColor:'rgba(255,255,255,.08)'},speedOn:{backgroundColor:c.blue},speedText:{color:'rgba(255,255,255,.65)',fontSize:11,fontWeight:'800'},exportRatioLabel:{marginTop:14},exportButton:{minHeight:50,borderRadius:14,backgroundColor:c.blue,marginTop:13,alignItems:'center',justifyContent:'center',flexDirection:'row',gap:8},exportText:{color:'#fff',fontSize:14,fontWeight:'900'},rewardButton:{minHeight:48,borderRadius:14,borderWidth:1,borderColor:'rgba(255,255,255,.32)',backgroundColor:'rgba(255,255,255,.08)',marginTop:9,alignItems:'center',justifyContent:'center',flexDirection:'row',gap:8},rewardIcon:{color:'#fff',fontSize:12,fontWeight:'900'},rewardText:{color:'#fff',fontSize:13,fontWeight:'900'},localExportHint:{color:'rgba(255,255,255,.46)',fontSize:10,textAlign:'center',marginTop:8},
});
