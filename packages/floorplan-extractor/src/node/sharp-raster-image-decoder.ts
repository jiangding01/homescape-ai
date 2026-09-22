import sharp from 'sharp'
import {
  normalizeImageMediaType,
  type RasterImage,
  type RasterImageDecoder,
} from '../raster-image'

export interface SharpRasterImageDecoderOptions {
  maxInputBytes?: number
  maxInputPixels?: number
}

export class SharpRasterImageDecoder implements RasterImageDecoder {
  readonly id = 'sharp-raster-v0.1'

  private readonly maxInputBytes: number
  private readonly maxInputPixels: number

  constructor(options: SharpRasterImageDecoderOptions = {}) {
    const maxInputBytes =
      options.maxInputBytes ?? 20 * 1024 * 1024
    const maxInputPixels =
      options.maxInputPixels ?? 40_000_000

    if (
      !Number.isInteger(maxInputBytes) ||
      maxInputBytes < 1 ||
      maxInputBytes > 100 * 1024 * 1024
    ) {
      throw new Error(
        'maxInputBytes 必须是 1 ~ 100MB 之间的整数',
      )
    }

    if (
      !Number.isInteger(maxInputPixels) ||
      maxInputPixels < 1 ||
      maxInputPixels > 100_000_000
    ) {
      throw new Error(
        'maxInputPixels 必须是 1 ~ 100,000,000 之间的整数',
      )
    }

    this.maxInputBytes = maxInputBytes
    this.maxInputPixels = maxInputPixels
  }

  supports(mediaType: string) {
    const normalized = normalizeImageMediaType(mediaType)

    return (
      normalized === 'image/png' ||
      normalized === 'image/jpeg' ||
      normalized === 'image/jpg'
    )
  }

  async decode(bytes: Uint8Array): Promise<RasterImage> {
    if (bytes.byteLength === 0) {
      throw new Error('Image bytes 不能为空')
    }

    if (bytes.byteLength > this.maxInputBytes) {
      throw new Error(
        'Image bytes 超过限制：' +
          bytes.byteLength +
          ' > ' +
          this.maxInputBytes,
      )
    }

    const decoded = await sharp(bytes, {
      failOn: 'error',
      limitInputPixels: this.maxInputPixels,
      sequentialRead: true,
    })
      .rotate()
      .toColourspace('srgb')
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })

    const { width, height, channels } = decoded.info

    if (
      !Number.isInteger(width) ||
      !Number.isInteger(height) ||
      width <= 0 ||
      height <= 0 ||
      channels !== 4
    ) {
      throw new Error('Sharp Raster 输出尺寸或 Channels 无效')
    }

    const expectedBytes = width * height * channels

    if (decoded.data.byteLength !== expectedBytes) {
      throw new Error('Sharp Raster Buffer 长度无效')
    }

    const luminance = new Uint8Array(width * height)

    for (let pixel = 0; pixel < width * height; pixel += 1) {
      const offset = pixel * channels
      const red = decoded.data[offset] ?? 255
      const green = decoded.data[offset + 1] ?? 255
      const blue = decoded.data[offset + 2] ?? 255
      const alpha = decoded.data[offset + 3] ?? 255
      const inverseAlpha = 255 - alpha
      const compositedRed =
        (red * alpha + 255 * inverseAlpha) / 255
      const compositedGreen =
        (green * alpha + 255 * inverseAlpha) / 255
      const compositedBlue =
        (blue * alpha + 255 * inverseAlpha) / 255

      luminance[pixel] = Math.round(
        0.2126 * compositedRed +
          0.7152 * compositedGreen +
          0.0722 * compositedBlue,
      )
    }

    return {
      width,
      height,
      luminance,
    }
  }
}
