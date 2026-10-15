import { createHash } from 'node:crypto'
import sharp from 'sharp'
import { normalizeImageMediaType } from '../raster-image'
import type { PreparedVisionImage, VisionImagePreparer } from '../vision/vision-extractor'

export interface SharpVisionImagePreparerOptions {
  /** 长边上限；模型坐标系即缩放后的图像。默认 1568（常见视觉模型的原生分辨率）。 */
  maxLongEdgePx?: number
  maxInputBytes?: number
  maxInputPixels?: number
}

/**
 * 确定性预处理：EXIF 校正 → 透明区域合成白底 → 等比缩放到长边上限 → 无元数据 PNG。
 * 缩放由我们自己完成，模型看到的图像尺寸与坐标系因此是已知的，而不是 Provider 内部的隐式缩放。
 */
export class SharpVisionImagePreparer implements VisionImagePreparer {
  readonly id: string
  private readonly maxLongEdgePx: number
  private readonly maxInputBytes: number
  private readonly maxInputPixels: number

  constructor(options: SharpVisionImagePreparerOptions = {}) {
    this.maxLongEdgePx = options.maxLongEdgePx ?? 1568
    this.maxInputBytes = options.maxInputBytes ?? 20 * 1024 * 1024
    this.maxInputPixels = options.maxInputPixels ?? 40_000_000

    if (
      !Number.isInteger(this.maxLongEdgePx) ||
      this.maxLongEdgePx < 256 ||
      this.maxLongEdgePx > 8000
    ) {
      throw new Error('maxLongEdgePx 必须是 256 ~ 8000 之间的整数')
    }

    // libvips 版本会影响编码字节，计入 ID 使回放指纹随之变化。
    this.id = 'sharp-vision-v0.1:' + this.maxLongEdgePx + ':vips-' + sharp.versions.vips
  }

  async prepare(bytes: Uint8Array, mediaType: string): Promise<PreparedVisionImage> {
    const normalized = normalizeImageMediaType(mediaType)
    if (normalized !== 'image/png' && normalized !== 'image/jpeg') {
      throw new Error('视觉 Extractor 只接受 PNG / JPEG')
    }
    if (bytes.byteLength === 0 || bytes.byteLength > this.maxInputBytes) {
      throw new Error('图像字节数超出 0 ~ ' + this.maxInputBytes)
    }

    const oriented = await sharp(bytes, {
      failOn: 'error',
      limitInputPixels: this.maxInputPixels,
    })
      .rotate()
      .flatten({ background: '#ffffff' })
      .toColourspace('srgb')
      .png()
      .toBuffer({ resolveWithObject: true })

    const sourceWidthPx = oriented.info.width
    const sourceHeightPx = oriented.info.height
    const scale = Math.min(1, this.maxLongEdgePx / Math.max(sourceWidthPx, sourceHeightPx))
    const modelWidthPx = Math.max(1, Math.round(sourceWidthPx * scale))
    const modelHeightPx = Math.max(1, Math.round(sourceHeightPx * scale))

    const output = await sharp(oriented.data)
      .resize(modelWidthPx, modelHeightPx, { fit: 'fill', kernel: 'lanczos3' })
      .png({ compressionLevel: 9, adaptiveFiltering: false, palette: false })
      .toBuffer()

    return {
      bytes: new Uint8Array(output),
      mediaType: 'image/png',
      sha256: createHash('sha256').update(output).digest('hex'),
      sourceWidthPx,
      sourceHeightPx,
      modelWidthPx,
      modelHeightPx,
    }
  }
}
