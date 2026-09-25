import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import * as DocumentPicker from 'expo-document-picker';
import JSZip from 'jszip';
import { Project } from './types';

const KEY = '@frameloop/projects/v1';
export async function loadProjects(): Promise<Project[]> {
  try { return JSON.parse((await AsyncStorage.getItem(KEY)) || '[]'); } catch { return []; }
}
export async function saveProjects(projects: Project[]) {
  await AsyncStorage.setItem(KEY, JSON.stringify(projects));
}
export async function persistImage(source: string) {
  const dir = `${FileSystem.documentDirectory}frameloop/`;
  if (!(await FileSystem.getInfoAsync(dir)).exists) await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  const target = `${dir}${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;
  await FileSystem.copyAsync({ from: source, to: target });
  return target;
}

export async function exportBackup(projects: Project[]) {
  const zip = new JSZip();
  const manifest = JSON.parse(JSON.stringify(projects)) as Project[];
  for (const project of manifest) for (const photo of project.photos) {
    const info = await FileSystem.getInfoAsync(photo.uri);
    if (!info.exists) continue;
    const name = `${project.id}-${photo.id}.jpg`;
    zip.file(`photos/${name}`, await FileSystem.readAsStringAsync(photo.uri, { encoding: FileSystem.EncodingType.Base64 }), { base64: true });
    photo.uri = `photos/${name}`;
  }
  zip.file('manifest.json', JSON.stringify(manifest));
  const encoded = await zip.generateAsync({ type: 'base64', compression: 'DEFLATE' });
  const target = `${FileSystem.cacheDirectory}frameloop-backup-${Date.now()}.zip`;
  await FileSystem.writeAsStringAsync(target, encoded, { encoding: FileSystem.EncodingType.Base64 });
  return target;
}

export async function importBackup(): Promise<Project[] | null> {
  const picked = await DocumentPicker.getDocumentAsync({ type: 'application/zip', copyToCacheDirectory: true });
  if (picked.canceled || !picked.assets[0]) return null;
  const encoded = await FileSystem.readAsStringAsync(picked.assets[0].uri, { encoding: FileSystem.EncodingType.Base64 });
  const zip = await JSZip.loadAsync(encoded, { base64: true });
  const manifest = zip.file('manifest.json');
  if (!manifest) throw new Error('FrameLoop 백업 파일이 아니에요.');
  const projects = JSON.parse(await manifest.async('string')) as Project[];
  const dir = `${FileSystem.documentDirectory}frameloop/`;
  if (!(await FileSystem.getInfoAsync(dir)).exists) await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  for (const project of projects) for (const photo of project.photos) {
    const entry = zip.file(photo.uri);
    if (!entry) continue;
    const target = `${dir}${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;
    await FileSystem.writeAsStringAsync(target, await entry.async('base64'), { encoding: FileSystem.EncodingType.Base64 });
    photo.uri = target;
  }
  return projects;
}
