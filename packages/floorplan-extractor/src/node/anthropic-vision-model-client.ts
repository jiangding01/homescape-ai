import Anthropic from '@anthropic-ai/sdk'
import {
  VisionExtractionError,
  type VisionModelClient,
  type VisionModelRequest,
  type VisionModelResponse,
  type VisionStopReason,
} from '../vision/vision-extractor'

export interface AnthropicVisionModelClientOptions {
  /** 只在服务端 / 本地 CLI 读取，绝不进入浏览器或日志。 */
  apiKey: string
  baseURL?: string
  timeoutMs?: number
  maxRetries?: number
}

function stopReason(value: string | null): VisionStopReason {
  if (value === 'end_turn' || value === 'max_tokens' || value === 'refusal') return value
  return 'other'
}

/**
 * Anthropic Messages API 适配器：图像 + 指令，Structured Outputs 约束 JSON。
 * 不启用跨模型 fallback：评测需要知道是哪个模型给出的结果，拒绝按失败 Case 记录。
 */
export class AnthropicVisionModelClient implements VisionModelClient {
  readonly provider = 'anthropic'
  private readonly client: Anthropic

  constructor(options: AnthropicVisionModelClientOptions) {
    if (!options.apiKey.trim()) throw new Error('缺少 Anthropic API Key')
    this.client = new Anthropic({
      apiKey: options.apiKey,
      ...(options.baseURL ? { baseURL: options.baseURL } : {}),
      timeout: options.timeoutMs ?? 15 * 60 * 1000,
      maxRetries: options.maxRetries ?? 2,
    })
  }

  async complete(request: VisionModelRequest): Promise<VisionModelResponse> {
    try {
      return await this.send(request)
    } catch (error) {
      // 只保留状态码与错误类型，不透传 Provider 原文，避免请求细节进入报告。
      if (error instanceof Anthropic.APIError) {
        throw new VisionExtractionError(
          'provider_error',
          'Provider HTTP ' + String(error.status ?? 'network') + ' ' + error.name,
        )
      }
      throw error
    }
  }

  private async send(request: VisionModelRequest): Promise<VisionModelResponse> {
    const started = Date.now()
    const stream = this.client.messages.stream({
      model: request.model,
      max_tokens: request.maxOutputTokens,
      system: request.systemPrompt,
      output_config: {
        effort: request.effort,
        format: { type: 'json_schema', schema: request.responseSchema },
      },
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: request.image.mediaType,
                data: Buffer.from(request.image.bytes).toString('base64'),
              },
            },
            { type: 'text', text: request.userPrompt },
          ],
        },
      ],
    })
    const message = await stream.finalMessage()
    const text = message.content
      .flatMap((block) => (block.type === 'text' ? [block.text] : []))
      .join('')
    const requestId = stream.request_id

    return {
      provider: this.provider,
      requestedModel: request.model,
      servedModel: message.model,
      stopReason: stopReason(message.stop_reason),
      text,
      inputTokens: message.usage.input_tokens,
      outputTokens: message.usage.output_tokens,
      ...(requestId ? { requestId } : {}),
      latencyMs: Date.now() - started,
    }
  }
}
