package expo.modules.frameloopvideo

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.Rect
import android.graphics.RectF
import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaFormat
import android.media.MediaMuxer
import android.net.Uri
import androidx.exifinterface.media.ExifInterface
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import java.io.File
import java.nio.ByteBuffer
import java.util.UUID
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

internal class TimelapseOptions : Record {
  @Field var photoUris: Array<String> = emptyArray()
  @Field var transition: String = "smooth"
  @Field var frameDurationMs: Int = 900
  @Field var outputWidth: Int = 1080
  @Field var outputHeight: Int = 1920
  @Field var maxDurationSeconds: Double = 15.0
}

private class FrameLoopVideoException(code: String, message: String) : CodedException(code, message, null)

class FrameLoopVideoModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("FrameLoopVideo")
    Events("onProgress")

    AsyncFunction("createTimelapseAsync") { options: TimelapseOptions ->
      createTimelapse(options)
    }
  }

  private fun createTimelapse(options: TimelapseOptions): Map<String, Any> {
    if (options.photoUris.size !in 2..60) {
      throw FrameLoopVideoException("ERR_INVALID_PHOTOS", "영상은 사진 2~60장이 필요해요.")
    }
    val context = appContext.reactContext
      ?: throw FrameLoopVideoException("ERR_NO_CONTEXT", "앱 저장공간을 열지 못했어요.")
    val width = min(1080, max(360, options.outputWidth))
    val height = min(1920, max(640, options.outputHeight))
    if (width % 2 != 0 || height % 2 != 0) {
      throw FrameLoopVideoException("ERR_INVALID_SIZE", "지원하지 않는 영상 크기예요.")
    }

    val fps = 30
    val requestedFrameDuration = max(0.25, options.frameDurationMs / 1000.0)
    val maximumDuration = min(15.0, max(2.0, options.maxDurationSeconds))
    val totalDuration = min(maximumDuration, requestedFrameDuration * options.photoUris.size)
    val frameDuration = totalDuration / options.photoUris.size
    val frameCount = max(2, (totalDuration * fps).roundToInt())
    val output = File(context.cacheDir, "frameloop-${UUID.randomUUID()}.mp4")

    val format = MediaFormat.createVideoFormat(MediaFormat.MIMETYPE_VIDEO_AVC, width, height).apply {
      setInteger(MediaFormat.KEY_COLOR_FORMAT, MediaCodecInfo.CodecCapabilities.COLOR_FormatYUV420Flexible)
      setInteger(MediaFormat.KEY_BIT_RATE, 8_000_000)
      setInteger(MediaFormat.KEY_FRAME_RATE, fps)
      setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, 1)
    }
    val codec = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_VIDEO_AVC)
    val muxer = MediaMuxer(output.absolutePath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
    val bufferInfo = MediaCodec.BufferInfo()
    var trackIndex = -1
    var muxerStarted = false
    var currentBitmap: Bitmap? = null
    var nextBitmap: Bitmap? = null
    var currentBitmapIndex = -1
    var nextBitmapIndex = -1
    val canvasBitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
    val pixels = IntArray(width * height)
    val yuv = ByteArray(width * height * 3 / 2)

    try {
      codec.configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
      codec.start()

      fun drain(endOfStream: Boolean) {
        while (true) {
          val outputIndex = codec.dequeueOutputBuffer(bufferInfo, if (endOfStream) 10_000 else 0)
          when {
            outputIndex == MediaCodec.INFO_TRY_AGAIN_LATER -> if (!endOfStream) return
            outputIndex == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
              if (muxerStarted) throw FrameLoopVideoException("ERR_VIDEO_FORMAT", "영상 형식을 만들지 못했어요.")
              trackIndex = muxer.addTrack(codec.outputFormat)
              muxer.start()
              muxerStarted = true
            }
            outputIndex >= 0 -> {
              val encoded = codec.getOutputBuffer(outputIndex)
                ?: throw FrameLoopVideoException("ERR_VIDEO_BUFFER", "영상 데이터를 만들지 못했어요.")
              if (bufferInfo.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG != 0) bufferInfo.size = 0
              if (bufferInfo.size > 0) {
                if (!muxerStarted) throw FrameLoopVideoException("ERR_VIDEO_MUXER", "영상 파일을 시작하지 못했어요.")
                encoded.position(bufferInfo.offset)
                encoded.limit(bufferInfo.offset + bufferInfo.size)
                muxer.writeSampleData(trackIndex, encoded, bufferInfo)
              }
              codec.releaseOutputBuffer(outputIndex, false)
              if (bufferInfo.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) return
            }
          }
        }
      }

      for (frameIndex in 0 until frameCount) {
        val seconds = frameIndex.toDouble() / fps
        val position = min(options.photoUris.size - 0.0001, seconds / frameDuration)
        val imageIndex = min(options.photoUris.size - 1, position.toInt())
        val followingIndex = min(options.photoUris.size - 1, imageIndex + 1)
        val local = position - imageIndex
        val blend = if (options.transition == "smooth" && followingIndex != imageIndex) {
          max(0.0, min(1.0, (local - 0.38) / 0.62))
        } else 0.0

        if (currentBitmapIndex != imageIndex) {
          currentBitmap?.recycle()
          currentBitmap = loadOrientedBitmap(options.photoUris[imageIndex], width, height)
          currentBitmapIndex = imageIndex
        }
        if (blend > 0 && nextBitmapIndex != followingIndex) {
          nextBitmap?.recycle()
          nextBitmap = loadOrientedBitmap(options.photoUris[followingIndex], width, height)
          nextBitmapIndex = followingIndex
        }

        val canvas = Canvas(canvasBitmap)
        canvas.drawColor(Color.BLACK)
        drawCenterCrop(canvas, currentBitmap!!, width, height, 255)
        if (blend > 0) drawCenterCrop(canvas, nextBitmap!!, width, height, (blend * 255).roundToInt())
        bitmapToI420(canvasBitmap, pixels, yuv, width, height)

        var inputIndex: Int
        do {
          inputIndex = codec.dequeueInputBuffer(10_000)
          drain(false)
        } while (inputIndex < 0)
        val input = codec.getInputBuffer(inputIndex)
          ?: throw FrameLoopVideoException("ERR_VIDEO_BUFFER", "영상 데이터를 만들지 못했어요.")
        input.clear()
        input.put(yuv)
        codec.queueInputBuffer(inputIndex, 0, yuv.size, frameIndex * 1_000_000L / fps, 0)
        drain(false)
        if (frameIndex % 5 == 0 || frameIndex == frameCount - 1) {
          sendEvent("onProgress", mapOf("progress" to (frameIndex + 1).toDouble() / frameCount))
        }
      }

      var eosIndex: Int
      do {
        eosIndex = codec.dequeueInputBuffer(10_000)
        drain(false)
      } while (eosIndex < 0)
      codec.queueInputBuffer(eosIndex, 0, 0, frameCount * 1_000_000L / fps, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
      drain(true)

      return mapOf(
        "uri" to Uri.fromFile(output).toString(),
        "durationMs" to (totalDuration * 1000).roundToInt(),
        "frameCount" to frameCount
      )
    } catch (error: Exception) {
      output.delete()
      if (error is CodedException) throw error
      throw FrameLoopVideoException("ERR_VIDEO_CREATE", error.message ?: "영상을 만들지 못했어요.")
    } finally {
      currentBitmap?.recycle()
      nextBitmap?.recycle()
      canvasBitmap.recycle()
      try { codec.stop() } catch (_: Exception) {}
      codec.release()
      if (muxerStarted) try { muxer.stop() } catch (_: Exception) {}
      muxer.release()
    }
  }

  private fun loadOrientedBitmap(uri: String, targetWidth: Int, targetHeight: Int): Bitmap {
    val path = Uri.parse(uri).path ?: uri
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeFile(path, bounds)
    var sample = 1
    while (bounds.outWidth / (sample * 2) >= targetWidth && bounds.outHeight / (sample * 2) >= targetHeight) sample *= 2
    val decoded = BitmapFactory.decodeFile(path, BitmapFactory.Options().apply { inSampleSize = sample })
      ?: throw FrameLoopVideoException("ERR_IMAGE_LOAD", "사진을 불러오지 못했어요.")
    val exif = try { ExifInterface(path).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL) }
      catch (_: Exception) { ExifInterface.ORIENTATION_NORMAL }
    val matrix = Matrix().apply {
      when (exif) {
        ExifInterface.ORIENTATION_ROTATE_90 -> postRotate(90f)
        ExifInterface.ORIENTATION_ROTATE_180 -> postRotate(180f)
        ExifInterface.ORIENTATION_ROTATE_270 -> postRotate(270f)
        ExifInterface.ORIENTATION_FLIP_HORIZONTAL -> postScale(-1f, 1f)
        ExifInterface.ORIENTATION_FLIP_VERTICAL -> postScale(1f, -1f)
        ExifInterface.ORIENTATION_TRANSPOSE -> { postRotate(90f); postScale(-1f, 1f) }
        ExifInterface.ORIENTATION_TRANSVERSE -> { postRotate(270f); postScale(-1f, 1f) }
      }
    }
    if (matrix.isIdentity) return decoded
    val oriented = Bitmap.createBitmap(decoded, 0, 0, decoded.width, decoded.height, matrix, true)
    if (oriented !== decoded) decoded.recycle()
    return oriented
  }

  private fun drawCenterCrop(canvas: Canvas, bitmap: Bitmap, width: Int, height: Int, alpha: Int) {
    val scale = max(width.toFloat() / bitmap.width, height.toFloat() / bitmap.height)
    val drawWidth = bitmap.width * scale
    val drawHeight = bitmap.height * scale
    val destination = RectF((width - drawWidth) / 2, (height - drawHeight) / 2, (width + drawWidth) / 2, (height + drawHeight) / 2)
    canvas.drawBitmap(bitmap, Rect(0, 0, bitmap.width, bitmap.height), destination, Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG).apply { this.alpha = alpha })
  }

  private fun bitmapToI420(bitmap: Bitmap, pixels: IntArray, output: ByteArray, width: Int, height: Int) {
    bitmap.getPixels(pixels, 0, width, 0, 0, width, height)
    val frameSize = width * height
    var yIndex = 0
    var uIndex = frameSize
    var vIndex = frameSize + frameSize / 4
    for (row in 0 until height) {
      for (column in 0 until width) {
        val color = pixels[row * width + column]
        val r = color shr 16 and 0xff
        val g = color shr 8 and 0xff
        val b = color and 0xff
        output[yIndex++] = clamp(((66 * r + 129 * g + 25 * b + 128) shr 8) + 16).toByte()
        if (row % 2 == 0 && column % 2 == 0) {
          output[uIndex++] = clamp(((-38 * r - 74 * g + 112 * b + 128) shr 8) + 128).toByte()
          output[vIndex++] = clamp(((112 * r - 94 * g - 18 * b + 128) shr 8) + 128).toByte()
        }
      }
    }
  }

  private fun clamp(value: Int) = min(255, max(0, value))
}
