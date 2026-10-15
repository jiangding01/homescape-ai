import {
  API_V1_PREFIX,
  CommitRevisionRequestSchema,
  CommitRevisionResponseSchema,
  CreateProjectRequestSchema,
  ProjectDetailSchema,
  ProjectListResponseSchema,
  TimelineChangeRequestSchema,
  TimelineChangeResponseSchema,
  UploadSpatialModelRequestSchema,
} from '@homescape/contracts'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { ApiHttpError } from '../errors'
import type { ProjectService } from '../services/project-service'

/** 空间模型较大，上传接口单独放宽请求体上限。 */
export const SPATIAL_MODEL_BODY_LIMIT_BYTES = 4 * 1024 * 1024

z.config(z.locales.zhCN())

function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body ?? {})

  if (!result.success) {
    throw new ApiHttpError(400, 'INVALID_REQUEST', '请求格式无效。', {
      issues: result.error.issues.slice(0, 20).map((issue) => ({
        path: issue.path.map(String).join('.'),
        message: issue.message,
      })),
    })
  }

  return result.data
}

type ProjectParams = { Params: { id: string } }

export function registerProjectRoutes(server: FastifyInstance, service: ProjectService) {
  server.get(API_V1_PREFIX + '/projects', async () =>
    ProjectListResponseSchema.parse(service.listProjects()),
  )

  server.post(
    API_V1_PREFIX + '/projects',
    { bodyLimit: SPATIAL_MODEL_BODY_LIMIT_BYTES },
    async (request, reply) => {
      const body = parseBody(CreateProjectRequestSchema, request.body)
      const detail = service.createProject(body)
      return reply.code(201).send(ProjectDetailSchema.parse(detail))
    },
  )

  server.get<ProjectParams>(API_V1_PREFIX + '/projects/:id', async (request) =>
    ProjectDetailSchema.parse(service.getProject(request.params.id)),
  )

  server.post<ProjectParams>(
    API_V1_PREFIX + '/projects/:id/spatial-models',
    { bodyLimit: SPATIAL_MODEL_BODY_LIMIT_BYTES },
    async (request, reply) => {
      const body = parseBody(UploadSpatialModelRequestSchema, request.body)
      const detail = service.uploadSpatialModel(request.params.id, body.spatialModel)
      return reply.code(201).send(ProjectDetailSchema.parse(detail))
    },
  )

  server.post<ProjectParams>(API_V1_PREFIX + '/projects/:id/revisions', async (request, reply) => {
    const body = parseBody(CommitRevisionRequestSchema, request.body)
    const result = await service.commitRevision(request.params.id, body)
    return reply.code(201).send(CommitRevisionResponseSchema.parse(result))
  })

  server.post<ProjectParams>(API_V1_PREFIX + '/projects/:id/undo', async (request) => {
    const body = parseBody(TimelineChangeRequestSchema, request.body)
    return TimelineChangeResponseSchema.parse(service.undo(request.params.id, body.baseRevisionId))
  })

  server.post<ProjectParams>(API_V1_PREFIX + '/projects/:id/redo', async (request) => {
    const body = parseBody(TimelineChangeRequestSchema, request.body)
    return TimelineChangeResponseSchema.parse(service.redo(request.params.id, body.baseRevisionId))
  })
}
