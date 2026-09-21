import type {
  DesignCommandInterpreter,
  DesignCommandRequest,
} from '@homescape/design-intelligence'
import type { FastifyInstance } from 'fastify'

export function registerDesignInterpretRoute(
  server: FastifyInstance,
  interpreter: DesignCommandInterpreter | undefined,
) {
  server.post<{ Body: DesignCommandRequest }>(
    '/api/design/interpret',
    async (request, reply) => {
      if (!interpreter) {
        return reply.code(503).send({
          error: {
            code: 'AI_NOT_CONFIGURED',
            message: '服务端尚未配置 TYPESAFE_API_KEY，自然语言设计决策暂不可用。',
          },
        })
      }

      const body = request.body

      if (
        !body ||
        typeof body.requestId !== 'string' ||
        !body.requestId.trim() ||
        typeof body.command !== 'string' ||
        !body.command.trim() ||
        !body.context ||
        typeof body.context.projectId !== 'string' ||
        !body.context.activeRoom ||
        typeof body.context.activeRoom.id !== 'string' ||
        !Array.isArray(body.context.objects)
      ) {
        return reply.code(400).send({
          error: {
            code: 'INVALID_DESIGN_COMMAND',
            message: '设计指令或上下文格式无效。',
          },
        })
      }

      try {
        return await interpreter.interpret(body)
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
