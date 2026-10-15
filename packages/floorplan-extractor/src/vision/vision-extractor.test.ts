import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  VisionExtractionError,
  VisionFloorPlanExtractor,
  type PreparedVisionImage,
  type VisionImagePreparer,
  type VisionModelClient,
  type VisionModelRequest,
  type VisionModelResponse,
} from './vision-extractor'
import {
  RecordingVisionModelClient,
  ReplayVisionModelClient,
  type StoredVisionResponse,
  type VisionResponseStore,
} from './vision-replay'
import {
  SYNTHETIC_MODEL_SIZE,
  SYNTHETIC_SOURCE_SIZE,
  syntheticVisionResponse,
} from './fixtures/synthetic-vision-response'

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex')

const preparer: VisionImagePreparer = {
  id: 'fake-preparer',
  async prepare(bytes): Promise<PreparedVisionImage> {
    return {
      bytes,
      mediaType: 'image/png',
      sha256: sha256(Buffer.from(bytes).toString('hex')),
      sourceWidthPx: SYNTHETIC_SOURCE_SIZE.widthPx,
      sourceHeightPx: SYNTHETIC_SOURCE_SIZE.heightPx,
      modelWidthPx: SYNTHETIC_MODEL_SIZE.widthPx,
      modelHeightPx: SYNTHETIC_MODEL_SIZE.heightPx,
    }
  },
}

class FakeClient implements VisionModelClient {
  readonly provider = 'fake'
  requests: VisionModelRequest[] = []
  constructor(private readonly reply: Partial<VisionModelResponse>) {}
  async complete(request: VisionModelRequest): Promise<VisionModelResponse> {
    this.requests.push(request)
    return {
      provider: this.provider,
      requestedModel: request.model,
      servedModel: request.model,
      stopReason: 'end_turn',
      text: JSON.stringify(syntheticVisionResponse()),
      inputTokens: 1200,
      outputTokens: 800,
      requestId: 'req_test',
      latencyMs: 42,
      ...this.reply,
    }
  }
}

function memoryStore(): VisionResponseStore & { value?: StoredVisionResponse } {
  const store: VisionResponseStore & { value?: StoredVisionResponse } = {
    async load() {
      return store.value
    },
    async save(record) {
      store.value = record
    },
  }
  return store
}

const input = {
  sourceId: 'case-synthetic',
  kind: 'floorplan_image' as const,
  mediaType: 'image/png',
  bytes: new Uint8Array([1, 2, 3]),
}

function extractor(client: VisionModelClient, effort: 'high' | 'low' = 'high') {
  return new VisionFloorPlanExtractor(preparer, client, {
    model: 'test-model',
    effort,
    sha256,
  })
}

async function expectFailure(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toBeInstanceOf(VisionExtractionError)
  await expect(promise).rejects.toMatchObject({ code })
}

describe('VisionFloorPlanExtractor', () => {
  it('生成通过校验的 Candidate，并记录模型、Token、Prompt 版本与请求指纹', async () => {
    const client = new FakeClient({})
    const result = await extractor(client).extract(input)

    expect(result.draft.rooms).toHaveLength(2)
    expect(result.metadata).toMatchObject({
      extractorId: 'vision-llm-v0.1',
      provider: 'fake',
      model: 'test-model',
      latencyMs: 42,
      inputTokens: 1200,
      outputTokens: 800,
      traceId: 'req_test',
      promptVersion: 'floorplan-vision-prompt-v2',
    })
    expect(result.metadata.requestFingerprint).toMatch(/^[a-f0-9]{64}$/)
    expect(client.requests[0]!.userPrompt).toContain('500 x 400 pixels')
  })

  it('请求指纹随模型参数变化，随同一输入保持不变', async () => {
    const a = await extractor(new FakeClient({})).buildRequest(input)
    const b = await extractor(new FakeClient({})).buildRequest(input)
    const c = await extractor(new FakeClient({}), 'low').buildRequest(input)

    expect(b.fingerprint).toBe(a.fingerprint)
    expect(c.fingerprint).not.toBe(a.fingerprint)
  })

  it('拒绝、截断、非 JSON、非户型图、无房间均作为带代码的失败', async () => {
    await expectFailure(
      extractor(new FakeClient({ stopReason: 'refusal' })).extract(input),
      'model_refusal',
    )
    await expectFailure(
      extractor(new FakeClient({ stopReason: 'max_tokens' })).extract(input),
      'output_truncated',
    )
    await expectFailure(
      extractor(new FakeClient({ text: '{"rooms": [' })).extract(input),
      'invalid_json',
    )
    await expectFailure(
      extractor(new FakeClient({ text: '{}' })).extract(input),
      'schema_violation',
    )
    await expectFailure(
      extractor(
        new FakeClient({
          text: JSON.stringify({
            ...syntheticVisionResponse(),
            isFloorPlan: false,
            notes: '是照片',
          }),
        }),
      ).extract(input),
      'not_a_floorplan',
    )
    await expectFailure(
      extractor(
        new FakeClient({ text: JSON.stringify({ ...syntheticVisionResponse(), rooms: [] }) }),
      ).extract(input),
      'no_rooms',
    )
  })

  it('不支持 PDF / 非户型来源', () => {
    const subject = extractor(new FakeClient({}))
    expect(subject.supports({ kind: 'floorplan_image', mediaType: 'image/jpeg' })).toBe(true)
    expect(subject.supports({ kind: 'floorplan_pdf', mediaType: 'application/pdf' })).toBe(false)
  })
})

describe('Record / Replay', () => {
  it('回放录制的响应得到逐字节相同的 Candidate，且不再调用模型', async () => {
    const store = memoryStore()
    const live = new FakeClient({})
    const recorded = await extractor(new RecordingVisionModelClient(live, store)).extract(input)

    expect(store.value?.fingerprint).toBe(recorded.metadata.requestFingerprint)

    const replayed = await extractor(new ReplayVisionModelClient('fake', store)).extract(input)
    expect(JSON.stringify(replayed.draft)).toBe(JSON.stringify(recorded.draft))
    expect(live.requests).toHaveLength(1)
  })

  it('配置变化后拒绝回放旧响应', async () => {
    const store = memoryStore()
    await extractor(new RecordingVisionModelClient(new FakeClient({}), store)).extract(input)

    await expectFailure(
      extractor(new ReplayVisionModelClient('fake', store), 'low').extract(input),
      'replay_mismatch',
    )
  })

  it('失败响应同样被录制，便于复盘', async () => {
    const store = memoryStore()
    await expect(
      extractor(
        new RecordingVisionModelClient(new FakeClient({ stopReason: 'refusal' }), store),
      ).extract(input),
    ).rejects.toMatchObject({ code: 'model_refusal' })
    expect(store.value?.response.stopReason).toBe('refusal')
  })

  it('没有录制响应时报告 replay_missing', async () => {
    await expectFailure(
      extractor(new ReplayVisionModelClient('fake', memoryStore())).extract(input),
      'replay_missing',
    )
  })
})
