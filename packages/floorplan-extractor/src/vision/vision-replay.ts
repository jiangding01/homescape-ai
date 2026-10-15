import {
  VisionExtractionError,
  type VisionModelClient,
  type VisionModelRequest,
  type VisionModelResponse,
} from './vision-extractor'

/** 落盘的模型原始响应。回放只需要它，不需要 API Key。 */
export interface StoredVisionResponse {
  schemaVersion: '0.1.0'
  fingerprint: string
  model: string
  effort: VisionModelRequest['effort']
  imageSha256: string
  recordedAt: string
  response: VisionModelResponse
}

export interface VisionResponseStore {
  load(): Promise<StoredVisionResponse | undefined>
  save(record: StoredVisionResponse): Promise<void>
}

/** 包装真实 Client：每次调用都把原始响应写入 Store（含拒绝 / 截断等失败响应）。 */
export class RecordingVisionModelClient implements VisionModelClient {
  readonly provider: string

  constructor(
    private readonly inner: VisionModelClient,
    private readonly store: VisionResponseStore,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.provider = inner.provider
  }

  async complete(request: VisionModelRequest) {
    const response = await this.inner.complete(request)
    await this.store.save({
      schemaVersion: '0.1.0',
      fingerprint: request.fingerprint,
      model: request.model,
      effort: request.effort,
      imageSha256: request.image.sha256,
      recordedAt: this.now().toISOString(),
      response,
    })
    return response
  }
}

/**
 * 从 Store 回放响应，不发起网络请求。请求指纹不一致（Prompt、Schema、模型参数或图像变了）
 * 时直接失败，避免把旧响应套在新配置上得出“可复现”的假象。
 */
export class ReplayVisionModelClient implements VisionModelClient {
  constructor(
    readonly provider: string,
    private readonly store: VisionResponseStore,
  ) {}

  async complete(request: VisionModelRequest) {
    const record = await this.store.load()

    if (!record) {
      throw new VisionExtractionError('replay_missing', '没有可回放的模型响应')
    }
    if (record.fingerprint !== request.fingerprint) {
      throw new VisionExtractionError(
        'replay_mismatch',
        '回放响应的请求指纹与当前配置不一致（Prompt / Schema / 模型参数 / 图像已变化）',
      )
    }

    return record.response
  }
}
