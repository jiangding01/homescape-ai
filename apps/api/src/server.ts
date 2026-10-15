import rateLimit from '@fastify/rate-limit'
import type { DesignCommandInterpreter } from '@homescape/design-intelligence'
import Fastify, { type FastifyError } from 'fastify'
import { createDesignCommandInterpreterFromEnv } from './ai'
import { registerDesignInterpretRoute } from './routes/design-interpret'
import { registerHealthRoute } from './routes/health'

export const REQUEST_BODY_LIMIT_BYTES = 64 * 1024

export interface BuildServerOptions {
  /** 显式传入（包括 undefined 表示“未配置 AI”）时不再读取环境变量。 */
  interpreter?: DesignCommandInterpreter | undefined
  logger?: boolean
  rateLimit?: { max: number; timeWindow: string | number }
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

  server.setErrorHandler((error: FastifyError, request, reply) => {
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
  })

  return server
}
