import type {
  FloorPlanExtractionResult,
  FloorPlanExtractor,
  FloorPlanExtractorInput,
} from './types'

export interface FloorPlanExtractorRegistryOptions {
  extractorId?: string
}

export class FloorPlanExtractorRegistry {
  private readonly extractors = new Map<string, FloorPlanExtractor>()

  register(extractor: FloorPlanExtractor) {
    if (this.extractors.has(extractor.id)) {
      throw new Error(
        'FloorPlanExtractor 已注册：' + extractor.id,
      )
    }

    this.extractors.set(extractor.id, extractor)
    return this
  }

  list() {
    return [...this.extractors.keys()].sort()
  }

  resolve(
    input: Pick<FloorPlanExtractorInput, 'kind' | 'mediaType'>,
    options: FloorPlanExtractorRegistryOptions = {},
  ) {
    if (options.extractorId) {
      const extractor = this.extractors.get(options.extractorId)

      if (!extractor) {
        throw new Error(
          '未知 FloorPlanExtractor：' + options.extractorId,
        )
      }

      if (!extractor.supports(input)) {
        throw new Error(
          options.extractorId +
            ' 不支持 ' +
            input.kind +
            ' / ' +
            input.mediaType,
        )
      }

      return extractor
    }

    const supported = [...this.extractors.values()].filter(
      (extractor) => extractor.supports(input),
    )

    if (supported.length === 0) {
      throw new Error(
        '没有 Extractor 支持 ' +
          input.kind +
          ' / ' +
          input.mediaType,
      )
    }

    if (supported.length > 1) {
      throw new Error(
        '存在多个可用 Extractor，请显式指定 extractorId：' +
          supported.map((extractor) => extractor.id).join(', '),
      )
    }

    return supported[0]!
  }

  async extract(
    input: FloorPlanExtractorInput,
    options: FloorPlanExtractorRegistryOptions = {},
  ): Promise<FloorPlanExtractionResult> {
    return this.resolve(input, options).extract(input)
  }
}
