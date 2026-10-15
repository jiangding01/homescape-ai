import type {
  DesignCommandInterpreter,
  DesignCommandRequest,
} from '@homescape/design-intelligence'
import type { FastifyInstance } from 'fastify'

const shortString = { type: 'string', maxLength: 100 } as const

export const MAX_COMMAND_LENGTH = 500
export const MAX_CONTEXT_OBJECTS = 100

const interpretBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['requestId', 'command', 'context'],
  properties: {
    requestId: { type: 'string', minLength: 1, maxLength: 100 },
    command: { type: 'string', minLength: 1, maxLength: MAX_COMMAND_LENGTH },
    context: {
      type: 'object',
      additionalProperties: false,
      required: ['projectId', 'activeRoom', 'objects'],
      properties: {
        projectId: shortString,
        activeRoom: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'name'],
          properties: { id: shortString, name: shortString },
        },
        objects: {
          type: 'array',
          maxItems: MAX_CONTEXT_OBJECTS,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['id', 'category', 'label', 'locked'],
            properties: {
              id: shortString,
              category: shortString,
              label: shortString,
              locked: { type: 'boolean' },
              roomId: shortString,
              zoneId: shortString,
              width: { type: 'number', minimum: 0, maximum: 100000 },
              colorFamily: shortString,
            },
          },
        },
      },
    },
  },
} as const

export function registerDesignInterpretRoute(
  server: FastifyInstance,
  interpreter: DesignCommandInterpreter | undefined,
  rateLimit: { max: number; timeWindow: string | number },
) {
  server.post<{ Body: DesignCommandRequest }>(
    '/api/design/interpret',
    {
      schema: { body: interpretBodySchema },
      config: { rateLimit },
    },
    async (request, reply) => {
      if (!interpreter) {
        return reply.code(503).send({
          error: {
            code: 'AI_NOT_CONFIGURED',
            message: '自然语言设计服务暂未启用，请联系管理员。',
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
