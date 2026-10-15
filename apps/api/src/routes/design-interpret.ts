import {
  DESIGN_INTERPRET_PATH,
  DesignCommandRequestSchema,
} from '@homescape/contracts'
import type {
  DesignCommandInterpreter,
  DesignCommandRequest,
} from '@homescape/design-intelligence'
import type { FastifyInstance } from 'fastify'

// 长度 / 数量上限与多余字段拒绝由契约包 DesignCommandRequestSchema 定义，前后端共用。
export function registerDesignInterpretRoute(
  server: FastifyInstance,
  interpreter: DesignCommandInterpreter | undefined,
  rateLimit: { max: number; timeWindow: string | number },
) {
  server.post(
    DESIGN_INTERPRET_PATH,
    { config: { rateLimit } },
    async (request, reply) => {
      // 先校验请求再判断服务是否启用，与迁移前的行为保持一致。
      const parsed = DesignCommandRequestSchema.safeParse(request.body)

      if (!parsed.success) {
        return reply.code(400).send({
          error: {
            code: 'INVALID_DESIGN_COMMAND',
            message: '设计指令或上下文格式无效，或超出长度/数量上限。',
          },
        })
      }

      if (!interpreter) {
        return reply.code(503).send({
          error: {
            code: 'AI_NOT_CONFIGURED',
            message: '自然语言设计服务暂未启用，请联系管理员。',
          },
        })
      }

      try {
        // zod 对可选字段推断为 `?: T | undefined`，解析结果中缺省的键不会被补上，
        // 与 exactOptionalPropertyTypes 下的领域类型在运行时一致。
        return await interpreter.interpret(parsed.data as DesignCommandRequest)
      } catch (error) {
        request.log.error({ err: error }, '自然语言设计指令解析失败')

        return reply.code(502).send({
          error: {
            code: 'AI_DECISION_FAILED',
            message: 'AI 决策服务暂时无法完成这次解析，请稍后重试。',
          },
        })
      }
    },
  )
}
