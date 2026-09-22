import type {
  FloorPlanExtractionResult,
  FloorPlanExtractor,
  FloorPlanExtractorInput,
} from './types'
import {
  parseFloorPlanGeometryObservation,
  type FloorPlanGeometryDetector,
} from './geometry-observation'
import {
  OrthogonalGeometryReconstructor,
  type OrthogonalGeometryReconstructorOptions,
} from './orthogonal-reconstruction'

export interface GeometryFloorPlanExtractorOptions
  extends OrthogonalGeometryReconstructorOptions {
  extractorId?: string
}

function optionalNonNegativeFinite(
  value: number | undefined,
  label: string,
) {
  if (value === undefined) return undefined

  if (!Number.isFinite(value) || value < 0) {
    throw new Error(label + ' 必须为非负有限数值')
  }

  return value
}

function optionalNonNegativeInteger(
  value: number | undefined,
  label: string,
) {
  const normalized = optionalNonNegativeFinite(value, label)

  if (normalized !== undefined && !Number.isInteger(normalized)) {
    throw new Error(label + ' 必须为整数')
  }

  return normalized
}

function optionalNonEmptyString(
  value: string | undefined,
  label: string,
) {
  if (value === undefined) return undefined

  if (!value.trim()) {
    throw new Error(label + ' 不能为空')
  }

  return value
}

export class GeometryFloorPlanExtractor implements FloorPlanExtractor {
  readonly id: string

  private readonly detector: FloorPlanGeometryDetector
  private readonly reconstructor: OrthogonalGeometryReconstructor

  constructor(
    detector: FloorPlanGeometryDetector,
    options: GeometryFloorPlanExtractorOptions = {},
  ) {
    if (!detector.id.trim()) {
      throw new Error('FloorPlanGeometryDetector.id 不能为空')
    }

    if (
      options.extractorId !== undefined &&
      !options.extractorId.trim()
    ) {
      throw new Error('extractorId 不能为空')
    }

    this.detector = detector
    this.id =
      options.extractorId ??
      'geometry-' + detector.id + '-orthogonal-v0.1'
    this.reconstructor = new OrthogonalGeometryReconstructor(options)
  }

  supports(
    input: Pick<FloorPlanExtractorInput, 'kind' | 'mediaType'>,
  ) {
    return this.detector.supports(input)
  }

  async extract(
    input: FloorPlanExtractorInput,
  ): Promise<FloorPlanExtractionResult> {
    const startedAt = performance.now()
    const detected = await this.detector.detect(input)
    const observation = parseFloorPlanGeometryObservation(
      detected.observation,
    )

    if (observation.source.kind !== input.kind) {
      throw new Error(
        'Geometry Detector source.kind 与 Extractor Input 不一致',
      )
    }

    const reconstructed = this.reconstructor.reconstruct(
      observation,
    )
    const provider = optionalNonEmptyString(
      detected.provider,
      'Geometry Detector provider',
    )
    const model = optionalNonEmptyString(
      detected.model,
      'Geometry Detector model',
    )
    const inputTokens = optionalNonNegativeInteger(
      detected.inputTokens,
      'Geometry Detector inputTokens',
    )
    const outputTokens = optionalNonNegativeInteger(
      detected.outputTokens,
      'Geometry Detector outputTokens',
    )
    const costUsd = optionalNonNegativeFinite(
      detected.costUsd,
      'Geometry Detector costUsd',
    )
    const traceId = optionalNonEmptyString(
      detected.traceId,
      'Geometry Detector traceId',
    )
    const warnings = [
      ...(detected.warnings ?? []),
      ...(reconstructed.warnings ?? []),
    ]

    return {
      draft: reconstructed.draft,
      metadata: {
        extractorId: this.id,
        provider: provider ?? this.detector.id,
        model:
          (model ?? this.detector.id) +
          '+' +
          this.reconstructor.id,
        latencyMs: performance.now() - startedAt,
        ...(inputTokens !== undefined
          ? { inputTokens }
          : {}),
        ...(outputTokens !== undefined
          ? { outputTokens }
          : {}),
        ...(costUsd !== undefined
          ? { costUsd }
          : {}),
        ...(traceId !== undefined
          ? { traceId }
          : {}),
      },
      ...(warnings.length > 0 ? { warnings } : {}),
    }
  }
}
