import type { DesignCommandInterpreter } from '@homescape/design-intelligence'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildServer } from '../server'

type TestServer = ReturnType<typeof buildServer>

const servers: TestServer[] = []

function createServer(options: Parameters<typeof buildServer>[0]) {
  const server = buildServer({ logger: false, ...options })
  servers.push(server)
  return server
}

function fakeInterpreter() {
  const interpret = vi.fn(async () => ({ status: 'no_change' }))
  return {
    interpret,
    instance: { interpret } as unknown as DesignCommandInterpreter,
  }
}

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    requestId: 'req-1',
    command: '把沙发换成浅灰色',
    context: {
      projectId: 'project-1',
      activeRoom: { id: 'room-1', name: '客厅' },
      objects: [
        { id: 'obj-1', category: 'sofa', label: '三人沙发', locked: false },
      ],
    },
    ...overrides,
  }
}

function post(server: TestServer, payload: unknown) {
  return server.inject({
    method: 'POST',
    url: '/api/design/interpret',
    payload: payload as object,
  })
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()))
})

describe('POST /api/design/interpret', () => {
  it('合法请求交给 interpreter 处理', async () => {
    const { instance, interpret } = fakeInterpreter()
    const server = createServer({ interpreter: instance })

    const response = await post(server, validBody())

    expect(response.statusCode).toBe(200)
    expect(interpret).toHaveBeenCalledTimes(1)
  })

  it('command 超过 500 字符返回 400', async () => {
    const { instance, interpret } = fakeInterpreter()
    const server = createServer({ interpreter: instance })

    const response = await post(server, validBody({ command: '长'.repeat(501) }))

    expect(response.statusCode).toBe(400)
    expect(response.json().error.code).toBe('INVALID_DESIGN_COMMAND')
    expect(interpret).not.toHaveBeenCalled()
  })

  it('command 为空字符串返回 400', async () => {
    const server = createServer({ interpreter: fakeInterpreter().instance })

    const response = await post(server, validBody({ command: '' }))

    expect(response.statusCode).toBe(400)
  })

  it('仅含空白的 command 被业务校验拒绝', async () => {
    const server = createServer({ interpreter: fakeInterpreter().instance })

    const response = await post(server, validBody({ command: '   ' }))

    expect(response.statusCode).toBe(400)
  })

  it('objects 超过 100 项返回 400', async () => {
    const { instance, interpret } = fakeInterpreter()
    const server = createServer({ interpreter: instance })
    const objects = Array.from({ length: 101 }, (_, index) => ({
      id: 'obj-' + index,
      category: 'chair',
      label: '椅子',
      locked: false,
    }))
    const body = validBody()

    const response = await post(server, {
      ...body,
      context: { ...body.context, objects },
    })

    expect(response.statusCode).toBe(400)
    expect(interpret).not.toHaveBeenCalled()
  })

  it('对象字段过长或带多余顶层字段返回 400', async () => {
    const server = createServer({ interpreter: fakeInterpreter().instance })
    const body = validBody()

    const longLabel = await post(server, {
      ...body,
      context: {
        ...body.context,
        objects: [
          { id: 'obj-1', category: 'sofa', label: '长'.repeat(101), locked: false },
        ],
      },
    })
    const extraField = await post(server, { ...body, extra: 'x' })

    expect(longLabel.statusCode).toBe(400)
    expect(extraField.statusCode).toBe(400)
  })

  it('请求体超过 bodyLimit 返回 413', async () => {
    const server = createServer({ interpreter: fakeInterpreter().instance })

    const response = await post(
      server,
      validBody({ requestId: 'x'.repeat(70 * 1024) }),
    )

    expect(response.statusCode).toBe(413)
  })

  it('超过限流阈值返回 429 与中文提示', async () => {
    const server = createServer({
      interpreter: fakeInterpreter().instance,
      rateLimit: { max: 2, timeWindow: '1 minute' },
    })

    const statuses: number[] = []
    let last = await post(server, validBody())
    statuses.push(last.statusCode)
    last = await post(server, validBody())
    statuses.push(last.statusCode)
    last = await post(server, validBody())
    statuses.push(last.statusCode)

    expect(statuses).toEqual([200, 200, 429])
    expect(last.json().error.code).toBe('RATE_LIMITED')
    expect(last.json().error.message).toContain('请求过于频繁')
  })

  it('限流不影响 /api/health', async () => {
    const server = createServer({
      interpreter: undefined,
      rateLimit: { max: 1, timeWindow: '1 minute' },
    })

    for (let index = 0; index < 3; index += 1) {
      const response = await server.inject({ method: 'GET', url: '/api/health' })
      expect(response.statusCode).toBe(200)
    }
  })

  it('未配置 AI 返回 503，且消息不含环境变量名', async () => {
    const server = createServer({ interpreter: undefined })

    const response = await post(server, validBody())

    expect(response.statusCode).toBe(503)
    expect(response.json().error.code).toBe('AI_NOT_CONFIGURED')
    expect(response.body).not.toContain('TYPESAFE')
  })

  it('interpreter 抛错时返回 502 且不泄露上游文本', async () => {
    const interpret = vi.fn(async () => {
      throw new Error('upstream secret detail')
    })
    const server = createServer({
      interpreter: { interpret } as unknown as DesignCommandInterpreter,
    })

    const response = await post(server, validBody())

    expect(response.statusCode).toBe(502)
    expect(response.body).not.toContain('upstream secret detail')
  })
})
