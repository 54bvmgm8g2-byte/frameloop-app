import { Asset, requestPermissionsAsync } from 'expo-media-library';
import * as Sharing from 'expo-sharing';
import FrameLoopVideoModule from '../modules/frameloop-video/src/FrameLoopVideoModule';
import { Project } from './types';

export type TimelapseOptions = {
  transition: 'cut' | 'smooth';
  frameDurationMs: number;
  aspectRatio: '9:16' | '4:5' | '1:1';
  quality?: '1080p' | '4k';
};

export async function createTimelapse(
  project: Project,
  options: TimelapseOptions,
  onProgress?: (value: number) => void,
) {
  if (!FrameLoopVideoModule) throw new Error('영상 만들기는 출시용 앱 빌드에서 사용할 수 있어요.');
  if (project.photos.length < 2) throw new Error('영상은 사진이 2장 이상 필요해요.');
  if (project.photos.length > 60) throw new Error('안정적인 영상 생성을 위해 한 번에 최대 60장까지 지원해요.');

  const subscription = FrameLoopVideoModule.addListener('onProgress', ({ progress }) => {
    onProgress?.(Math.max(0, Math.min(1, progress)));
  });
  try {
    onProgress?.(0);
    const shortEdge = options.quality === '4k' ? 2160 : 1080;
    const outputSize = options.aspectRatio === '9:16'
      ? { width: shortEdge, height: shortEdge / 9 * 16 }
      : options.aspectRatio === '4:5'
        ? { width: shortEdge, height: shortEdge / 4 * 5 }
        : { width: shortEdge, height: shortEdge };
    const result = await FrameLoopVideoModule.createTimelapseAsync({
      photoUris: project.photos.map(photo => photo.uri),
      transition: options.transition,
      frameDurationMs: options.frameDurationMs,
      outputWidth: outputSize.width,
      outputHeight: outputSize.height,
      maxDurationSeconds: 15,
    });
    onProgress?.(1);
    return result.uri;
  } finally {
    subscription.remove();
  }
}

export async function saveVideoToLibrary(uri: string) {
  const permission = await requestPermissionsAsync(true, ['video']);
  if (permission.status !== 'granted') throw new Error('사진 앱 저장 권한이 필요해요.');
  await Asset.create(uri);
}

export async function shareVideo(uri: string) {
  if (!(await Sharing.isAvailableAsync())) throw new Error('이 기기에서는 공유 기능을 사용할 수 없어요.');
  await Sharing.shareAsync(uri, { mimeType: 'video/mp4', UTI: 'public.mpeg-4', dialogTitle: 'FrameLoop 변화 영상 공유' });
}
