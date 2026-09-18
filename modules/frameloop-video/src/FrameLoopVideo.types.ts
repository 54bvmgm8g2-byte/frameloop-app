export type TimelapseTransition = 'cut' | 'smooth';

export type CreateTimelapseOptions = {
  photoUris: string[];
  transition: TimelapseTransition;
  frameDurationMs: number;
  outputWidth?: number;
  outputHeight?: number;
  maxDurationSeconds?: number;
};

export type TimelapseResult = {
  uri: string;
  durationMs: number;
  frameCount: number;
};

export type FrameLoopVideoEvents = {
  onProgress: (event: { progress: number }) => void;
};
