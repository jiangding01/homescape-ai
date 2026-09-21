import type { AICapability, AIProvider, AIRequest, AIResult } from './types'

export class AIProviderRegistry {
  private readonly providers = new Map<string, AIProvider>()

  register(provider: AIProvider) {
    if (this.providers.has(provider.id)) {
      throw new Error('AI provider already registered: ' + provider.id)
    }
    this.providers.set(provider.id, provider)
  }

  resolve(capability: AICapability, providerHint?: string) {
    if (providerHint) {
      const hinted = this.providers.get(providerHint)
      if (!hinted) throw new Error('Unknown AI provider: ' + providerHint)
      if (!hinted.supports(capability)) {
        throw new Error('Provider does not support capability: ' + capability)
      }
      return hinted
    }

    const provider = [...this.providers.values()].find((item) => item.supports(capability))
    if (!provider) throw new Error('No provider registered for capability: ' + capability)
    return provider
  }

  async execute<TInput, TOutput>(request: AIRequest<TInput>): Promise<AIResult<TOutput>> {
    const provider = this.resolve(request.capability, request.providerHint)
    return provider.execute(request) as Promise<AIResult<TOutput>>
  }
}
