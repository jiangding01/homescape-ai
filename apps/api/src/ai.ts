import { AIProviderRegistry, JevProvider } from '@homescape/ai-runtime'
import { DesignCommandInterpreter } from '@homescape/design-intelligence'

export function createDesignCommandInterpreterFromEnv() {
  const apiKey = process.env.TYPESAFE_API_KEY?.trim()
  if (!apiKey) return undefined

  const model = process.env.TYPESAFE_MODEL?.trim() || 'jev-latest'
  const baseUrl = process.env.TYPESAFE_BASE_URL?.trim()

  const provider = new JevProvider({
    apiKey,
    defaultModel: model,
    ...(baseUrl ? { baseUrl } : {}),
  })
  const registry = new AIProviderRegistry()
  registry.register(provider)

  return new DesignCommandInterpreter(registry, {
    providerHint: provider.id,
    modelHint: model,
  })
}
