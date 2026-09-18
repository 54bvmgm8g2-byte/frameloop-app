import { NativeModule, requireOptionalNativeModule } from 'expo';
import type { CreateTimelapseOptions, FrameLoopVideoEvents, TimelapseResult } from './FrameLoopVideo.types';

declare class FrameLoopVideoModule extends NativeModule<FrameLoopVideoEvents> {
  createTimelapseAsync(options: CreateTimelapseOptions): Promise<TimelapseResult>;
}

export default requireOptionalNativeModule<FrameLoopVideoModule>('FrameLoopVideo');
