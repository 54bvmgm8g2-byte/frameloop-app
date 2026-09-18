import { registerWebModule, NativeModule } from 'expo';

// FrameLoopVideoModule is not available on the web platform.
class FrameLoopVideoModule extends NativeModule<{}> {}

export default registerWebModule(FrameLoopVideoModule, 'FrameLoopVideoModule');
