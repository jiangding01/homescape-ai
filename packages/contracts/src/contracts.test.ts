import { sampleApartment } from '@homescape/spatial-model'
import { describe, expect, it } from 'vitest'
import {
  CommitRevisionRequestSchema,
  DesignCommandRequestSchema,
  DesignInterpretationSchema,
  MAX_COMMAND_LENGTH,
  MAX_CONTEXT_OBJECTS,
  CreateProjectRequestSchema,
  MAX_OPERATIONS_PER_REVISION,
  TimelineChangeRequestSchema,
  UploadSpatialModelRequestSchema,
} from './index'

const addSofa = {
  id: 'op-1',
  type: 'add_object',
  source: 'user',
  scope: { type: 'room', roomId: 'room-living' },
  category: 'sofa',
  requirements: { maxWidth: 2.3 },
}

describe('契约 schema', () => {
  it('接受合法的提交请求，baseRevisionId 可为 null', () => {
    const parsed = CommitRevisionRequestSchema.parse({
      baseRevisionId: null,
      operations: [addSofa],
      request: '加一张沙发',
      provenance: { provider: 'p', model: 'm' },
    })

    expect(parsed.operations[0]?.type).toBe('add_object')
  })

  it('拒绝多余字段、未知操作类型、空操作列表与超量操作', () => {
    const base = { baseRevisionId: null, operations: [addSofa] }

    expect(CommitRevisionRequestSchema.safeParse({ ...base, extra: 1 }).success).toBe(false)
    expect(
      CommitRevisionRequestSchema.safeParse({
        ...base,
        operations: [{ ...addSofa, type: 'teleport' }],
      }).success,
    ).toBe(false)
    expect(
      CommitRevisionRequestSchema.safeParse({ ...base, operations: [{ ...addSofa, hack: 1 }] })
        .success,
    ).toBe(false)
    expect(CommitRevisionRequestSchema.safeParse({ ...base, operations: [] }).success).toBe(false)
    expect(
      CommitRevisionRequestSchema.safeParse({
        ...base,
        operations: Array.from({ length: MAX_OPERATIONS_PER_REVISION + 1 }, () => addSofa),
      }).success,
    ).toBe(false)
    expect(CommitRevisionRequestSchema.safeParse({ operations: [addSofa] }).success).toBe(false)
  })

  it('空间模型只做顶层结构检查', () => {
    expect(
      UploadSpatialModelRequestSchema.safeParse({ spatialModel: sampleApartment }).success,
    ).toBe(true)
    expect(
      UploadSpatialModelRequestSchema.safeParse({ spatialModel: { id: 'x', floors: [] } }).success,
    ).toBe(false)
  })

  it('创建项目的字段均可选，撤销 / 重做必须携带 baseRevisionId', () => {
    expect(CreateProjectRequestSchema.parse({})).toEqual({})
    expect(CreateProjectRequestSchema.safeParse({ name: '   ' }).success).toBe(false)
    expect(TimelineChangeRequestSchema.safeParse({}).success).toBe(false)
    expect(TimelineChangeRequestSchema.parse({ baseRevisionId: 'r1' })).toEqual({
      baseRevisionId: 'r1',
    })
  })

  describe('interpret 接口', () => {
    const validRequest = {
      requestId: 'req-1',
      command: '把沙发换成浅灰色',
      context: {
        projectId: 'p1',
        activeRoom: { id: 'room-1', name: '客厅' },
        objects: [{ id: 'o1', category: 'sofa', label: '沙发', locked: false, width: 2 }],
      },
    }
    const parse = (value: unknown) => DesignCommandRequestSchema.safeParse(value).success

    it('接受合法请求，拒绝超长 / 空白指令与多余字段', () => {
      expect(parse(validRequest)).toBe(true)
      expect(parse({ ...validRequest, command: '长'.repeat(MAX_COMMAND_LENGTH) })).toBe(true)
      expect(parse({ ...validRequest, command: '长'.repeat(MAX_COMMAND_LENGTH + 1) })).toBe(false)
      expect(parse({ ...validRequest, command: '   ' })).toBe(false)
      expect(parse({ ...validRequest, requestId: '' })).toBe(false)
      expect(parse({ ...validRequest, extra: 1 })).toBe(false)
      expect(
        parse({ ...validRequest, context: { ...validRequest.context, extra: 1 } }),
      ).toBe(false)
    })

    it('限制上下文对象数量、字段长度与宽度范围', () => {
      const object = { id: 'o', category: 'c', label: 'l', locked: false }
      const withObjects = (objects: unknown[]) => ({
        ...validRequest,
        context: { ...validRequest.context, objects },
      })

      expect(parse(withObjects(Array.from({ length: MAX_CONTEXT_OBJECTS }, () => object)))).toBe(true)
      expect(parse(withObjects(Array.from({ length: MAX_CONTEXT_OBJECTS + 1 }, () => object)))).toBe(false)
      expect(parse(withObjects([{ ...object, label: '长'.repeat(101) }]))).toBe(false)
      expect(parse(withObjects([{ ...object, width: -1 }]))).toBe(false)
      expect(parse(withObjects([{ ...object, width: 100001 }]))).toBe(false)
      expect(parse(withObjects([{ ...object, extra: 1 }]))).toBe(false)
    })

    it('响应 schema 校验结构并接受缺省 usage', () => {
      const signal = { value: 'x', confidence: 0.9 }
      const response = {
        status: 'no_change',
        message: 'ok',
        operations: [],
        decisions: {
          intent: signal,
          scope: signal,
          target: signal,
          category: signal,
          size: signal,
          color: signal,
          seats: signal,
          style: signal,
          preserveOthers: 1,
        },
        meta: { provider: 'p', model: 'm', latencyMs: 12 },
      }

      expect(DesignInterpretationSchema.safeParse(response).success).toBe(true)
      expect(DesignInterpretationSchema.safeParse({ ...response, status: 'bogus' }).success).toBe(false)
      expect(DesignInterpretationSchema.safeParse({ status: 'ready' }).success).toBe(false)
    })
  })
})
