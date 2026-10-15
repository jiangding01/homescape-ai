import { isFloorPlanDraft } from '@homescape/spatial-model'
import type {
  FloorPlanExtractionResult,
  FloorPlanExtractor,
  FloorPlanExtractorInput,
} from '../types'
import { normalizeImageMediaType } from '../raster-image'
import { buildVisionUserPrompt, VISION_PROMPT_VERSION, VISION_SYSTEM_PROMPT } from './vision-prompt'
import {
  parseVisionFloorPlanResponse,
  VISION_FLOORPLAN_RESPONSE_JSON_SCHEMA,
  VisionResponseSchemaError,
} from './vision-schema'
import { visionResponseToDraft, type VisionDraftConversionStats } from './vision-to-draft'

/** 送入模型前的确定性预处理结果（EXIF 校正、缩放、统一编码）。 */
export interface PreparedVisionImage {
  bytes: Uint8Array
  mediaType: 'image/png' | 'image/jpeg'
  sha256: string
  sourceWidthPx: number
  sourceHeightPx: number
  modelWidthPx: number
  modelHeightPx: number
}

export interface VisionImagePreparer {
  readonly id: string
  prepare(bytes: Uint8Array, mediaType: string): Promise<PreparedVisionImage>
}

export interface VisionModelRequest {
  /** 请求指纹：模型、参数、Prompt、Schema、图像哈希的摘要；回放时用于防止错配。 */
  fingerprint: string
  model: string
  effort: VisionEffort
  maxOutputTokens: number
  systemPrompt: string
  userPrompt: string
  responseSchema: typeof VISION_FLOORPLAN_RESPONSE_JSON_SCHEMA
  image: PreparedVisionImage
}

export type VisionStopReason = 'end_turn' | 'max_tokens' | 'refusal' | 'other'

export interface VisionModelResponse {
  provider: string
  requestedModel: string
  servedModel: string
  stopReason: VisionStopReason
  text: string
  inputTokens?: number
  outputTokens?: number
  requestId?: string
  latencyMs: number
}

/** Vendor 无关的视觉模型调用边界；具体 Provider 在 node 子路径实现（API Key 只在服务端）。 */
export interface VisionModelClient {
  readonly provider: string
  complete(request: VisionModelRequest): Promise<VisionModelResponse>
}

export type VisionEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

export type VisionExtractionFailureCode =
  | 'model_refusal'
  | 'output_truncated'
  | 'invalid_json'
  | 'schema_violation'
  | 'not_a_floorplan'
  | 'no_rooms'
  | 'invalid_draft'
  | 'replay_missing'
  | 'replay_mismatch'
  | 'provider_error'

export class VisionExtractionError extends Error {
  constructor(
    readonly code: VisionExtractionFailureCode,
    message: string,
    readonly response?: VisionModelResponse,
  ) {
    super(message)
    this.name = 'VisionExtractionError'
  }
}

export interface VisionFloorPlanExtractorOptions {
  extractorId?: string
  model: string
  effort?: VisionEffort
  maxOutputTokens?: number
  assumedPixelsPerMeter?: number
  /** 注入哈希实现，保持核心包不依赖 node:crypto。 */
  sha256: (text: string) => string
}

export interface VisionFloorPlanExtractionResult extends FloorPlanExtractionResult {
  response: VisionModelResponse
  stats: VisionDraftConversionStats
}

export const VISION_EXTRACTOR_ID = 'vision-llm-v0.1'

/** Prompt + Schema 的版本摘要，写入报告，用于判断两次运行是否可比。 */
export function visionPromptFingerprint(sha256: (text: string) => string) {
  return sha256(
    JSON.stringify([
      VISION_PROMPT_VERSION,
      VISION_SYSTEM_PROMPT,
      buildVisionUserPrompt({ widthPx: 0, heightPx: 0 }),
      VISION_FLOORPLAN_RESPONSE_JSON_SCHEMA,
    ]),
  )
}

export class VisionFloorPlanExtractor implements FloorPlanExtractor {
  readonly id: string
  private readonly effort: VisionEffort
  private readonly maxOutputTokens: number

  constructor(
    private readonly preparer: VisionImagePreparer,
    private readonly client: VisionModelClient,
    private readonly options: VisionFloorPlanExtractorOptions,
  ) {
    if (!options.model.trim()) throw new Error('model 不能为空')
    this.id = options.extractorId ?? VISION_EXTRACTOR_ID
    this.effort = options.effort ?? 'high'
    this.maxOutputTokens = options.maxOutputTokens ?? 64000
  }

  supports(input: Pick<FloorPlanExtractorInput, 'kind' | 'mediaType'>) {
    const mediaType = normalizeImageMediaType(input.mediaType)
    return (
      input.kind === 'floorplan_image' && (mediaType === 'image/png' || mediaType === 'image/jpeg')
    )
  }

  async buildRequest(input: FloorPlanExtractorInput): Promise<VisionModelRequest> {
    const image = await this.preparer.prepare(input.bytes, input.mediaType)
    const userPrompt = buildVisionUserPrompt({
      widthPx: image.modelWidthPx,
      heightPx: image.modelHeightPx,
    })
    const fingerprint = this.options.sha256(
      JSON.stringify([
        this.client.provider,
        this.options.model,
        this.effort,
        this.maxOutputTokens,
        this.preparer.id,
        VISION_PROMPT_VERSION,
        VISION_SYSTEM_PROMPT,
        userPrompt,
        VISION_FLOORPLAN_RESPONSE_JSON_SCHEMA,
        image.sha256,
      ]),
    )

    return {
      fingerprint,
      model: this.options.model,
      effort: this.effort,
      maxOutputTokens: this.maxOutputTokens,
      systemPrompt: VISION_SYSTEM_PROMPT,
      userPrompt,
      responseSchema: VISION_FLOORPLAN_RESPONSE_JSON_SCHEMA,
      image,
    }
  }

  async extract(input: FloorPlanExtractorInput): Promise<VisionFloorPlanExtractionResult> {
    if (!this.supports(input)) {
      throw new Error(this.id + ' 只支持 PNG / JPEG 户型图')
    }

    const request = await this.buildRequest(input)
    const response = await this.client.complete(request)

    if (response.stopReason === 'refusal') {
      throw new VisionExtractionError('model_refusal', '模型拒绝处理该图片', response)
    }
    if (response.stopReason === 'max_tokens') {
      throw new VisionExtractionError(
        'output_truncated',
        '模型输出达到 maxOutputTokens 上限被截断',
        response,
      )
    }

    let raw: unknown
    try {
      raw = JSON.parse(response.text)
    } catch {
      throw new VisionExtractionError('invalid_json', '模型输出不是有效 JSON', response)
    }

    let parsed
    try {
      parsed = parseVisionFloorPlanResponse(raw)
    } catch (error) {
      if (error instanceof VisionResponseSchemaError) {
        throw new VisionExtractionError('schema_violation', error.message, response)
      }
      throw error
    }

    if (!parsed.isFloorPlan) {
      throw new VisionExtractionError(
        'not_a_floorplan',
        '模型判断图片不是户型图：' + parsed.notes,
        response,
      )
    }

    const conversion = visionResponseToDraft(parsed, {
      sourceId: input.sourceId,
      sourceWidthPx: request.image.sourceWidthPx,
      sourceHeightPx: request.image.sourceHeightPx,
      modelWidthPx: request.image.modelWidthPx,
      modelHeightPx: request.image.modelHeightPx,
      ...(this.options.assumedPixelsPerMeter !== undefined
        ? { assumedPixelsPerMeter: this.options.assumedPixelsPerMeter }
        : {}),
    })

    if (conversion.draft.rooms.length === 0) {
      throw new VisionExtractionError('no_rooms', '模型没有给出可用的房间多边形', response)
    }
    if (!isFloorPlanDraft(conversion.draft)) {
      throw new VisionExtractionError(
        'invalid_draft',
        '转换后的 FloorPlanDraft 未通过结构校验',
        response,
      )
    }

    return {
      draft: conversion.draft,
      metadata: {
        extractorId: this.id,
        provider: response.provider,
        model: response.servedModel,
        latencyMs: response.latencyMs,
        ...(response.inputTokens !== undefined ? { inputTokens: response.inputTokens } : {}),
        ...(response.outputTokens !== undefined ? { outputTokens: response.outputTokens } : {}),
        ...(response.requestId ? { traceId: response.requestId } : {}),
        promptVersion: VISION_PROMPT_VERSION,
        requestFingerprint: request.fingerprint,
      },
      ...(conversion.warnings.length > 0 ? { warnings: conversion.warnings } : {}),
      response,
      stats: conversion.stats,
    }
  }
}
