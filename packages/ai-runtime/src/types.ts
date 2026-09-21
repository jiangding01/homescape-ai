export type AICapability =
  | 'typed_decision'
  | 'reasoning'
  | 'vision'
  | 'structured_extraction'
  | 'embedding'
  | 'rerank'
  | 'image_generation'
  | 'speech'

export interface AIRequest<TInput> {
  capability: AICapability
  input: TInput
  providerHint?: string
  modelHint?: string
  timeoutMs?: number
}

export interface AIResult<TOutput> {
  data: TOutput
  meta: {
    provider: string
    model: string
    latencyMs: number
    degraded?: boolean
    usage?: {
      inputTokens?: number
      outputTokens?: number
      cost?: number
    }
  }
}

export interface AIProvider<TInput = unknown, TOutput = unknown> {
  id: string
  supports(capability: AICapability): boolean
  execute(request: AIRequest<TInput>): Promise<AIResult<TOutput>>
}
