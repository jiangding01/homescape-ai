export interface RasterImage {
  width: number
  height: number
  luminance: Uint8Array
}

export interface RasterImageDecoder {
  readonly id: string
  supports(mediaType: string): boolean
  decode(bytes: Uint8Array): Promise<RasterImage>
}

export function normalizeImageMediaType(mediaType: string) {
  return mediaType.split(';', 1)[0]?.trim().toLowerCase() ?? ''
}
