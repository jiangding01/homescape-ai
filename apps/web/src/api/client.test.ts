import { describe, expect, it, vi } from 'vitest'
import { makeCommitResponse, makeInterpretation, makeProject } from '../store/test-fixtures'
import { ApiClientError, createApiClient, describeApiError } from './client'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function clientWith(fetchImpl: (input: string, init?: RequestInit) => Promise<Response>, timeout?: number) {
  const fetchMock = vi.fn(fetchImpl)
  const api = createApiClient({
    fetch: fetchMock,
    ...(timeout ? { defaultTimeoutMs: timeout } : {}),
  })
  return { api, fetchMock }
}

async function caught(promise: Promise<unknown>): Promise<ApiClientError> {
  try {
    await promise
  } catch (error) {
    expect(error).toBeInstanceOf(ApiClientError)
    return error as ApiClientError
  }
  throw new Error('预期请求失败')
}

describe('API 客户端', () => {
  it('成功响应按契约 schema 解析，并以 JSON 提交请求体', async () => {
    const project = makeProject({ head: 'rev-1' })
    const { api, fetchMock } = clientWith(async () => jsonResponse(makeCommitResponse(project), 201))

    const result = await api.commitRevision('project-1', {
      baseRevisionId: null,
      operations: [
        {
          id: 'op-1',
          type: 'lock',
          source: 'user',
          scope: { type: 'object', objectId: 'o' },
          targetId: 'o',
        },
      ],
    })

    expect(result.project.headRevisionId).toBe('rev-1')
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('/api/v1/projects/project-1/revisions')
    expect(init?.method).toBe('POST')
    expect(JSON.parse(String(init?.body)).baseRevisionId).toBeNull()
  })

  it('项目 ID 在路径中被编码', async () => {
    const { api, fetchMock } = clientWith(async () => jsonResponse(makeProject()))

    await api.getProject('a/b c')

    expect(fetchMock.mock.calls[0]![0]).toBe('/api/v1/projects/a%2Fb%20c')
  })

  it('响应 JSON 不符合契约时抛 invalid_response，而不是直接断言类型', async () => {
    const { api } = clientWith(async () => jsonResponse({ projects: [{ id: 1 }] }))

    const error = await caught(api.listProjects())

    expect(error.kind).toBe('invalid_response')
    expect(error.message).toContain('格式不符合预期')
  })

  it('非 JSON 响应（如网关错误页）给出带状态码的提示', async () => {
    const { api } = clientWith(async () => new Response('<html>Bad Gateway</html>', { status: 502 }))

    const error = await caught(api.listProjects())

    expect(error.kind).toBe('invalid_response')
    expect(error.status).toBe(502)
    expect(error.message).toContain('HTTP 502')
  })

  it('409 冲突携带当前 head，并可识别为 REVISION_CONFLICT', async () => {
    const { api } = clientWith(async () =>
      jsonResponse(
        { error: { code: 'REVISION_CONFLICT', message: '版本已变化', headRevisionId: 'rev-9' } },
        409,
      ),
    )

    const error = await caught(api.undo('project-1', 'rev-1'))

    expect(error.isRevisionConflict).toBe(true)
    expect(error.headRevisionId).toBe('rev-9')
  })

  it('NOTHING_TO_UNDO 同为 409，但不属于版本冲突', async () => {
    const { api } = clientWith(async () =>
      jsonResponse({ error: { code: 'NOTHING_TO_UNDO', message: '没有可撤销的修订' } }, 409),
    )

    const error = await caught(api.undo('project-1', null))

    expect(error.status).toBe(409)
    expect(error.isRevisionConflict).toBe(false)
  })

  it('422 保留违规列表，describeApiError 展示违规原因', async () => {
    const { api } = clientWith(async () =>
      jsonResponse(
        {
          error: {
            code: 'CONSTRAINT_VIOLATION',
            message: '修改未通过空间约束校验，设计未改变。',
            violations: [
              { code: 'COLLISION', severity: 'error', message: '沙发与茶几重叠' },
              { code: 'NEAR_WALL', severity: 'warning', message: '距离墙面较近' },
            ],
          },
        },
        422,
      ),
    )

    const error = await caught(api.commitRevision('p', { baseRevisionId: null, operations: [] as never }))

    expect(error.isUnprocessable).toBe(true)
    expect(error.violations).toHaveLength(2)
    const text = describeApiError(error)
    expect(text).toContain('未通过空间约束校验')
    expect(text).toContain('沙发与茶几重叠')
    expect(text).not.toContain('距离墙面较近')
  })

  it('错误响应不符合契约时退化为带状态码的通用错误', async () => {
    const { api } = clientWith(async () => jsonResponse({ oops: true }, 500))

    const error = await caught(api.listProjects())

    expect(error.kind).toBe('invalid_response')
    expect(error.message).toContain('HTTP 500')
  })

  it('fetch 失败映射为 network 错误', async () => {
    const { api } = clientWith(async () => {
      throw new TypeError('Failed to fetch')
    })

    const error = await caught(api.listProjects())

    expect(error.kind).toBe('network')
    expect(error.message).toContain('无法连接')
  })

  it('超时会中止请求并映射为 timeout 错误', async () => {
    const { api } = clientWith(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          )
        }),
      20,
    )

    const error = await caught(api.listProjects())

    expect(error.kind).toBe('timeout')
    expect(error.message).toContain('请求超时')
  })

  it('interpret 使用旧接口路径并校验响应', async () => {
    const { api, fetchMock } = clientWith(async () => jsonResponse(makeInterpretation()))

    const result = await api.interpret({
      requestId: 'r',
      command: '布置客厅',
      context: { projectId: 'p', activeRoom: { id: 'room', name: '客厅' }, objects: [] },
    })

    expect(result.status).toBe('ready')
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/design/interpret')
  })

  it('503 AI 未配置作为 http 错误透出服务端文案', async () => {
    const { api } = clientWith(async () =>
      jsonResponse({ error: { code: 'AI_NOT_CONFIGURED', message: '自然语言设计服务暂未启用。' } }, 503),
    )

    const error = await caught(
      api.interpret({
        requestId: 'r',
        command: 'x',
        context: { projectId: 'p', activeRoom: { id: 'a', name: 'b' }, objects: [] },
      }),
    )

    expect(error.code).toBe('AI_NOT_CONFIGURED')
    expect(describeApiError(error)).toBe('自然语言设计服务暂未启用。')
  })
})
