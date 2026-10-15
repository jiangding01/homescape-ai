import { sampleApartment } from '@homescape/spatial-model'
import { describe, expect, it } from 'vitest'
import {
  CommitRevisionRequestSchema,
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
})
