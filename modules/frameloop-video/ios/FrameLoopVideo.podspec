Pod::Spec.new do |s|
  s.name           = 'FrameLoopVideo'
  s.version        = '1.0.0'
  s.summary        = 'On-device timelapse renderer for FrameLoop'
  s.description    = 'Creates private H.264 MP4 timelapses without uploading photos.'
  s.author         = 'FrameLoop'
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = {
    :ios => '16.4'
  }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  # Swift/Objective-C compatibility
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
