import rateLimit from '@fastify/rate-limit'
import { InMemoryCatalog, livingRoomCatalog } from '@homescape/catalog'
import type { DesignCommandInterpreter } from '@homescape/design-intelligence'
import { RuleBasedPlanner, type SpatialPlanner } from '@homescape/planner'
import Fastify, { type FastifyError } from 'fastify'
import { createDesignCommandInterpreterFromEnv } from './ai'
import { ApiHttpError } from './errors'
import type { IdGenerator } from './ids'
import { registerDesignInterpretRoute } from './routes/design-interpret'
import { registerHealthRoute } from './routes/health'
import { registerProjectRoutes } from './routes/projects'
import { ProjectService } from './services/project-service'
import { IN_MEMORY_DATABASE, openSqliteDesignStore } from './storage/sqlite-store'
import type { DesignStore } from './storage/types'

export const REQUEST_BODY_LIMIT_BYTES = 64 * 1024

export interface BuildServerOptions {
  /** 显式传入（包括 undefined 表示“未配置 AI”）时不再读取环境变量。 */
  interpreter?: DesignCommandInterpreter | undefined
  logger?: boolean
  rateLimit?: { max: number; timeWindow: string | number }
  /** 外部传入的存储由调用方负责关闭；否则按 databasePath 打开并在 server 关闭时关闭。 */
  store?: DesignStore
  /** SQLite 文件路径，缺省为内存库（生产入口 index.ts 负责解析默认文件路径）。 */
  databasePath?: string
  planner?: SpatialPlanner
  createId?: IdGenerator
}

export function buildServer(options: BuildServerOptions = {}) {
  const server = Fastify({
    logger: options.logger ?? true,
    bodyLimit: REQUEST_BODY_LIMIT_BYTES,
    // 严格校验：不静默剔除多余字段，不做类型隐式转换。
    ajv: { customOptions: { removeAdditional: false, coerceTypes: false } },
  })
  const designCommandInterpreter =
    'interpreter' in options
      ? options.interpreter
      : createDesignCommandInterpreterFromEnv()

  const ownsStore = !options.store
  const store = options.store ?? openSqliteDesignStore(options.databasePath ?? IN_MEMORY_DATABASE)

  if (ownsStore) {
    server.addHook('onClose', async () => store.close())
  }

  const projectService = new ProjectService({
    store,
    planner: options.planner ?? new RuleBasedPlanner(new InMemoryCatalog(livingRoomCatalog)),
    ...(options.createId ? { createId: options.createId } : {}),
  })
  projectService.ensureSampleProject()

  server.setErrorHandler((error: FastifyError, request, reply) => {
    if (error instanceof ApiHttpError) {
      return reply.code(error.statusCode).send(error.toResponse())
    }

    if (error.validation) {
      return reply.code(400).send({
        error: {
          code: 'INVALID_DESIGN_COMMAND',
          message: '设计指令或上下文格式无效，或超出长度/数量上限。',
        },
      })
    }

    if (error.statusCode === 429) {
      return reply.code(429).send({
        error: {
          code: 'RATE_LIMITED',
          message: '请求过于频繁，请稍后再试。',
        },
      })
    }

    if (error.statusCode === 413) {
      return reply.code(413).send({
        error: {
          code: 'PAYLOAD_TOO_LARGE',
          message: '请求内容过大。',
        },
      })
    }

    request.log.error({ err: error }, '请求处理失败')
    const statusCode =
      error.statusCode && error.statusCode >= 400 ? error.statusCode : 500
    return reply.code(statusCode).send({
      error: {
        code: statusCode >= 500 ? 'INTERNAL_ERROR' : 'BAD_REQUEST',
        message: statusCode >= 500 ? '服务内部错误。' : '请求无效。',
      },
    })
  })

  // global: false，仅对显式声明 config.rateLimit 的路由生效。
  server.register(rateLimit, { global: false })

  // 路由须在 rate-limit 插件加载完成后注册，onRoute 钩子才会生效。
  server.register(async (instance) => {
    registerHealthRoute(instance)
    registerDesignInterpretRoute(
      instance,
      designCommandInterpreter,
      options.rateLimit ?? { max: 20, timeWindow: '1 minute' },
    )
    registerProjectRoutes(instance, projectService)
  })

  return server
}
