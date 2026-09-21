import type {
  ChoiceDecisionAnswer,
  NoulDecisionAnswer,
  ScoreDecisionAnswer,
  TypedDecisionAnswer,
  TypedDecisionInput,
  TypedDecisionOutput,
} from '../typed-decision'
import type { AICapability, AIProvider, AIRequest, AIResult } from '../types'

const DEFAULT_BASE_URL = 'https://api.typesafe.ai'
const DEFAULT_MODEL = 'jev-latest'
const RETRYABLE_STATUS = new Set([429, 529])

export interface JevProviderOptions {
  apiKey: string
  baseUrl?: string
  defaultModel?: string
  maxRetries?: number
  fetchImpl?: typeof fetch
}

export class JevProviderError extends Error {
  readonly status: number | undefined

  constructor(message: string, status?: number) {
    super(message)
    this.name = 'JevProviderError'
    this.status = status
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function finiteNumber(value: unknown, label: string) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new JevProviderError('TypeSafe 返回了无效字段：' + label)
  }
  return value
}

function parseNumberRecord(value: unknown, label: string) {
  const record = asRecord(value)
  if (!record) throw new JevProviderError('TypeSafe 返回了无效字段：' + label)

  const result: Record<string, number> = {}
  for (const [key, entry] of Object.entries(record)) {
    result[key] = finiteNumber(entry, label + '.' + key)
  }
  return result
}

function parseStringRecord(value: unknown, label: string) {
  const record = asRecord(value)
  if (!record) throw new JevProviderError('TypeSafe 返回了无效字段：' + label)

  const result: Record<string, string> = {}
  for (const [key, entry] of Object.entries(record)) {
    if (typeof entry !== 'string') {
      throw new JevProviderError('TypeSafe 返回了无效字段：' + label + '.' + key)
    }
    result[key] = entry
  }
  return result
}

function parseAnswer(value: unknown, questionId: string): TypedDecisionAnswer {
  const record = asRecord(value)
  if (!record || typeof record.type !== 'string') {
    throw new JevProviderError('TypeSafe 缺少答案：' + questionId)
  }

  if (record.type === 'noul') {
    const answer: NoulDecisionAnswer = {
      type: 'noul',
      noul: finiteNumber(record.noul, questionId + '.noul'),
    }
    return answer
  }

  if (record.type === 'choice') {
    if (typeof record.choice !== 'string') {
      throw new JevProviderError('TypeSafe 返回了无效 Choice：' + questionId)
    }

    const answer: ChoiceDecisionAnswer = {
      type: 'choice',
      choice: record.choice,
      probabilities: parseNumberRecord(record.probabilities, questionId + '.probabilities'),
      confidence: finiteNumber(record.confidence, questionId + '.confidence'),
    }
    return answer
  }

  if (record.type === 'score') {
    const answer: ScoreDecisionAnswer = {
      type: 'score',
      score: finiteNumber(record.score, questionId + '.score'),
      legend: parseStringRecord(record.legend, questionId + '.legend'),
      probabilities: parseNumberRecord(record.probabilities, questionId + '.probabilities'),
      confidence: finiteNumber(record.confidence, questionId + '.confidence'),
    }
    return answer
  }

  throw new JevProviderError('TypeSafe 返回了未知答案类型：' + String(record.type))
}

function parseResponse(value: unknown) {
  const record = asRecord(value)
  if (!record || typeof record.model !== 'string') {
    throw new JevProviderError('TypeSafe 返回格式无效')
  }

  const rawAnswers = asRecord(record.answers)
  if (!rawAnswers) throw new JevProviderError('TypeSafe 响应缺少 answers')

  const answers: Record<string, TypedDecisionAnswer> = {}
  for (const [questionId, answer] of Object.entries(rawAnswers)) {
    answers[questionId] = parseAnswer(answer, questionId)
  }

  const usage = asRecord(record.usage)
  const inputTokens =
    usage && typeof usage.input_tokens === 'number' ? usage.input_tokens : undefined
  const outputTokens =
    usage && typeof usage.output_tokens === 'number' ? usage.output_tokens : undefined

  return {
    model: record.model,
    answers,
    usage:
      inputTokens !== undefined || outputTokens !== undefined
        ? {
            ...(inputTokens !== undefined ? { inputTokens } : {}),
            ...(outputTokens !== undefined ? { outputTokens } : {}),
          }
        : undefined,
  }
}

function isTypedDecisionInput(value: unknown): value is TypedDecisionInput {
  const record = asRecord(value)
  return Boolean(record && 'state' in record && asRecord(record.questions))
}

function sleep(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds))
}

export class JevProvider implements AIProvider {
  readonly id = 'typesafe-jev'

  private readonly apiKey: string
  private readonly baseUrl: string
  private readonly defaultModel: string
  private readonly maxRetries: number
  private readonly fetchImpl: typeof fetch

  constructor(options: JevProviderOptions) {
    const apiKey = options.apiKey.trim()
    if (!apiKey) throw new Error('JevProvider 需要非空 apiKey')

    this.apiKey = apiKey
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '')
    this.defaultModel = options.defaultModel ?? DEFAULT_MODEL
    this.maxRetries = Math.max(0, options.maxRetries ?? 2)
    this.fetchImpl = options.fetchImpl ?? fetch
  }

  supports(capability: AICapability) {
    return capability === 'typed_decision'
  }

  async execute(request: AIRequest<unknown>): Promise<AIResult<unknown>> {
    if (request.capability !== 'typed_decision') {
      throw new JevProviderError('JevProvider 不支持 capability：' + request.capability)
    }
    if (!isTypedDecisionInput(request.input)) {
      throw new JevProviderError('typed_decision 输入格式无效')
    }

    const startedAt = Date.now()
    const model = request.modelHint ?? this.defaultModel
    const timeoutMs = Math.max(250, request.timeoutMs ?? 5000)
    const url = this.baseUrl + '/v1/systemone'
    let lastError: Error | undefined

    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), timeoutMs)

      try {
        const response = await this.fetchImpl(url, {
          method: 'POST',
          headers: {
            Authorization: 'Bearer ' + this.apiKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            state: request.input.state,
            model,
            questions: request.input.questions,
          }),
          signal: controller.signal,
        })

        if (!response.ok) {
          if (RETRYABLE_STATUS.has(response.status) && attempt < this.maxRetries) {
            await sleep(250 * 2 ** attempt)
            continue
          }

          const responseText = (await response.text()).slice(0, 800)
          throw new JevProviderError(
            'TypeSafe 请求失败（HTTP ' + response.status + '）：' + responseText,
            response.status,
          )
        }

        const raw: unknown = await response.json()
        const parsed = parseResponse(raw)
        const output: TypedDecisionOutput = { answers: parsed.answers }

        return {
          data: output,
          meta: {
            provider: this.id,
            model: parsed.model,
            latencyMs: Date.now() - startedAt,
            ...(parsed.usage ? { usage: parsed.usage } : {}),
          },
        }
      } catch (error) {
        if (
          error instanceof JevProviderError &&
          !RETRYABLE_STATUS.has(error.status ?? 0)
        ) {
          throw error
        }

        if (error instanceof Error && error.name === 'AbortError') {
          lastError = new JevProviderError('TypeSafe 请求超时（' + timeoutMs + 'ms）')
        } else {
          lastError =
            error instanceof Error ? error : new JevProviderError('TypeSafe 请求失败')
        }

        if (attempt < this.maxRetries) {
          await sleep(250 * 2 ** attempt)
          continue
        }
      } finally {
        clearTimeout(timeout)
      }
    }

    throw lastError ?? new JevProviderError('TypeSafe 请求失败')
  }
}
