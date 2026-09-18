import AVFoundation
import ExpoModulesCore
import UIKit

private struct TimelapseOptions: Record {
  @Field var photoUris: [String] = []
  @Field var transition: String = "smooth"
  @Field var frameDurationMs: Int = 900
  @Field var outputWidth: Int = 1080
  @Field var outputHeight: Int = 1920
  @Field var maxDurationSeconds: Double = 15
}

private enum FrameLoopVideoError: Error, CodedError {
  case invalidPhotos
  case invalidSize
  case imageLoadFailed
  case writerSetupFailed
  case appendFailed

  var code: String {
    switch self {
    case .invalidPhotos: return "ERR_INVALID_PHOTOS"
    case .invalidSize: return "ERR_INVALID_SIZE"
    case .imageLoadFailed: return "ERR_IMAGE_LOAD"
    case .writerSetupFailed: return "ERR_WRITER_SETUP"
    case .appendFailed: return "ERR_VIDEO_APPEND"
    }
  }

  var description: String {
    switch self {
    case .invalidPhotos: return "영상은 사진 2~60장이 필요해요."
    case .invalidSize: return "지원하지 않는 영상 크기예요."
    case .imageLoadFailed: return "사진을 불러오지 못했어요."
    case .writerSetupFailed: return "영상 인코더를 시작하지 못했어요."
    case .appendFailed: return "영상 프레임을 저장하지 못했어요."
    }
  }
}

public class FrameLoopVideoModule: Module {
  public func definition() -> ModuleDefinition {
    Name("FrameLoopVideo")
    Events("onProgress")

    AsyncFunction("createTimelapseAsync") { (options: TimelapseOptions) async throws -> [String: Any] in
      try await self.createTimelapse(options)
    }
  }

  private func createTimelapse(_ options: TimelapseOptions) async throws -> [String: Any] {
    guard (2...60).contains(options.photoUris.count) else { throw FrameLoopVideoError.invalidPhotos }
    let width = min(1080, max(360, options.outputWidth))
    let height = min(1920, max(640, options.outputHeight))
    guard width.isMultiple(of: 2), height.isMultiple(of: 2) else { throw FrameLoopVideoError.invalidSize }

    let fps: Int32 = 30
    let requestedFrameDuration = max(0.25, Double(options.frameDurationMs) / 1000)
    let maximumDuration = min(15, max(2, options.maxDurationSeconds))
    let totalDuration = min(maximumDuration, requestedFrameDuration * Double(options.photoUris.count))
    let frameDuration = totalDuration / Double(options.photoUris.count)
    let frameCount = max(2, Int((totalDuration * Double(fps)).rounded()))

    let outputURL = FileManager.default.temporaryDirectory
      .appendingPathComponent("frameloop-\(UUID().uuidString).mp4")
    try? FileManager.default.removeItem(at: outputURL)

    let writer = try AVAssetWriter(outputURL: outputURL, fileType: .mp4)
    let settings: [String: Any] = [
      AVVideoCodecKey: AVVideoCodecType.h264,
      AVVideoWidthKey: width,
      AVVideoHeightKey: height,
      AVVideoCompressionPropertiesKey: [
        AVVideoAverageBitRateKey: 8_000_000,
        AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel,
        AVVideoMaxKeyFrameIntervalKey: Int(fps)
      ]
    ]
    let input = AVAssetWriterInput(mediaType: .video, outputSettings: settings)
    input.expectsMediaDataInRealTime = false
    let adaptor = AVAssetWriterInputPixelBufferAdaptor(
      assetWriterInput: input,
      sourcePixelBufferAttributes: [
        kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32ARGB,
        kCVPixelBufferWidthKey as String: width,
        kCVPixelBufferHeightKey as String: height
      ]
    )
    guard writer.canAdd(input) else { throw FrameLoopVideoError.writerSetupFailed }
    writer.add(input)
    guard writer.startWriting() else { throw writer.error ?? FrameLoopVideoError.writerSetupFailed }
    writer.startSession(atSourceTime: .zero)

    var imageCache: [Int: CGImage] = [:]
    let canvasSize = CGSize(width: width, height: height)
    let smooth = options.transition == "smooth"

    for frameIndex in 0..<frameCount {
      try Task.checkCancellation()
      while !input.isReadyForMoreMediaData {
        if writer.status == .failed { throw writer.error ?? FrameLoopVideoError.appendFailed }
        try await Task.sleep(nanoseconds: 3_000_000)
      }

      let seconds = Double(frameIndex) / Double(fps)
      let position = min(Double(options.photoUris.count) - 0.0001, seconds / frameDuration)
      let currentIndex = min(options.photoUris.count - 1, Int(position))
      let nextIndex = min(options.photoUris.count - 1, currentIndex + 1)
      let local = position - Double(currentIndex)
      let blendStart = 0.38
      let blend = smooth && nextIndex != currentIndex ? max(0, min(1, (local - blendStart) / (1 - blendStart))) : 0

      if imageCache[currentIndex] == nil {
        imageCache[currentIndex] = try normalizedImage(uri: options.photoUris[currentIndex], size: canvasSize)
      }
      if blend > 0, imageCache[nextIndex] == nil {
        imageCache[nextIndex] = try normalizedImage(uri: options.photoUris[nextIndex], size: canvasSize)
      }
      imageCache = imageCache.filter { $0.key == currentIndex || $0.key == nextIndex }

      guard let pool = adaptor.pixelBufferPool else { throw FrameLoopVideoError.writerSetupFailed }
      var buffer: CVPixelBuffer?
      guard CVPixelBufferPoolCreatePixelBuffer(nil, pool, &buffer) == kCVReturnSuccess,
            let pixelBuffer = buffer else { throw FrameLoopVideoError.appendFailed }
      try render(
        current: imageCache[currentIndex],
        next: blend > 0 ? imageCache[nextIndex] : nil,
        blend: blend,
        into: pixelBuffer,
        width: width,
        height: height
      )
      let time = CMTime(value: CMTimeValue(frameIndex), timescale: fps)
      guard adaptor.append(pixelBuffer, withPresentationTime: time) else {
        throw writer.error ?? FrameLoopVideoError.appendFailed
      }
      if frameIndex.isMultiple(of: 5) || frameIndex == frameCount - 1 {
        sendEvent("onProgress", ["progress": Double(frameIndex + 1) / Double(frameCount)])
      }
    }

    input.markAsFinished()
    await writer.finishWriting()
    guard writer.status == .completed else { throw writer.error ?? FrameLoopVideoError.appendFailed }
    return [
      "uri": outputURL.absoluteString,
      "durationMs": Int(totalDuration * 1000),
      "frameCount": frameCount
    ]
  }

  private func normalizedImage(uri: String, size: CGSize) throws -> CGImage {
    let path = URL(string: uri)?.path ?? uri
    guard let image = UIImage(contentsOfFile: path) else { throw FrameLoopVideoError.imageLoadFailed }
    let renderer = UIGraphicsImageRenderer(size: size)
    let output = renderer.image { context in
      UIColor.black.setFill()
      context.fill(CGRect(origin: .zero, size: size))
      let scale = max(size.width / image.size.width, size.height / image.size.height)
      let drawSize = CGSize(width: image.size.width * scale, height: image.size.height * scale)
      let rect = CGRect(
        x: (size.width - drawSize.width) / 2,
        y: (size.height - drawSize.height) / 2,
        width: drawSize.width,
        height: drawSize.height
      )
      image.draw(in: rect)
    }
    guard let cgImage = output.cgImage else { throw FrameLoopVideoError.imageLoadFailed }
    return cgImage
  }

  private func render(current: CGImage?, next: CGImage?, blend: Double, into buffer: CVPixelBuffer, width: Int, height: Int) throws {
    guard let current else { throw FrameLoopVideoError.imageLoadFailed }
    CVPixelBufferLockBaseAddress(buffer, [])
    defer { CVPixelBufferUnlockBaseAddress(buffer, []) }
    guard let base = CVPixelBufferGetBaseAddress(buffer),
          let context = CGContext(
            data: base,
            width: width,
            height: height,
            bitsPerComponent: 8,
            bytesPerRow: CVPixelBufferGetBytesPerRow(buffer),
            space: CGColorSpaceCreateDeviceRGB(),
            bitmapInfo: CGImageAlphaInfo.noneSkipFirst.rawValue
          ) else { throw FrameLoopVideoError.appendFailed }
    let rect = CGRect(x: 0, y: 0, width: width, height: height)
    context.setFillColor(UIColor.black.cgColor)
    context.fill(rect)
    context.translateBy(x: 0, y: CGFloat(height))
    context.scaleBy(x: 1, y: -1)
    context.setAlpha(1)
    context.draw(current, in: rect)
    if let next, blend > 0 {
      context.setAlpha(CGFloat(blend))
      context.draw(next, in: rect)
    }
  }
}
