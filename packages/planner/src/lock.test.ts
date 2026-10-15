import {
  commitToTimeline,
  createInitialDesignState,
  createRevisionTimeline,
  UnlockNotPermittedError,
  type DesignOperation,
  type DesignRevisionDraft,
} from '@homescape/domain'
import { describe, expect, it } from 'vitest'
import { RuleBasedPlanner } from './rule-based-planner'
import { rotatedSquareModel, testCatalog } from './test-fixtures'

const spatialModel = rotatedSquareModel(0)
const SOFA = 'object-sofa'

function lockedState() {
  return createInitialDesignState({
    projectId: 'project-test',
    spatialModelId: spatialModel.id,
    objects: [
      {
        id: SOFA,
        assetId: 'asset-wall-sofa',
        category: 'sofa',
        transform: { position: [5, 0, 5], yaw: 0 },
        roomId: 'room-1',
        dimensions: [2, 0.8, 0.9],
      },
    ],
    locks: [{ targetId: SOFA, lockedBy: 'user' }],
  })
}

const scope = { type: 'object', objectId: SOFA } as const

function unlock(source: DesignOperation['source']): DesignOperation {
  return { id: 'op-unlock', type: 'unlock', source, scope, targetId: SOFA }
}

function move(source: DesignOperation['source']): DesignOperation {
  return { id: 'op-move', type: 'move_object', source, scope, objectId: SOFA, position: [5, 0, 4] }
}

async function plan(operations: DesignOperation[]) {
  return new RuleBasedPlanner(testCatalog()).plan({
    spatialModel,
    state: lockedState(),
    operations,
  })
}

describe('锁不可被非用户来源解除', () => {
  it.each(['ai', 'planner', 'rule', 'system'] as const)('%s 发起的 unlock 被 Planner 拒绝', async (source) => {
    const result = await plan([unlock(source)])

    expect(result.mutations).toEqual([])
    expect(result.violations.map((violation) => violation.code)).toEqual([
      'planner.unlock_requires_user',
    ])
    expect(result.violations[0]?.severity).toBe('error')
  })

  it('user 发起的 unlock 成功', async () => {
    const result = await plan([unlock('user')])

    expect(result.violations).toEqual([])
    expect(result.mutations).toEqual([
      { type: 'set_lock', targetId: SOFA, locked: false, lockedBy: 'user' },
    ])
  })

  it('AI 输出 [unlock, move] 整体不生效', async () => {
    const result = await plan([unlock('ai'), move('ai')])

    expect(result.mutations).toEqual([])
    expect(result.violations.map((violation) => violation.code)).toEqual([
      'planner.unlock_requires_user',
      'planner.target_protected',
    ])
  })

  it('user 的 [unlock, move] 正常生效', async () => {
    const result = await plan([unlock('user'), move('user')])

    expect(result.violations).toEqual([])
    expect(result.mutations.map((mutation) => mutation.type)).toEqual(['set_lock', 'move_object'])
  })

  it('AI 代用户加锁仍被允许', async () => {
    const state = createInitialDesignState({
      projectId: 'project-test',
      spatialModelId: spatialModel.id,
    })
    const result = await new RuleBasedPlanner(testCatalog()).plan({
      spatialModel,
      state,
      operations: [{ id: 'op-lock', type: 'lock', source: 'ai', scope, targetId: SOFA }],
    })

    expect(result.violations).toEqual([])
    expect(result.mutations).toEqual([
      { type: 'set_lock', targetId: SOFA, locked: true, lockedBy: 'user' },
    ])
  })

  it('绕过 Planner 直接提交 AI 的 [unlock, move] 也会被 Revision 引擎拒绝', () => {
    const timeline = createRevisionTimeline(lockedState())
    const draft: DesignRevisionDraft = {
      id: 'revision-ai-bypass',
      projectId: 'project-test',
      expectedParentRevisionId: null,
      operations: [unlock('ai'), move('ai')],
      mutations: [
        { type: 'set_lock', targetId: SOFA, locked: false, lockedBy: 'user' },
        { type: 'move_object', objectId: SOFA, position: [5, 0, 4] },
      ],
      provenance: { actor: 'ai' },
      createdAt: '2026-01-01T00:00:00.000Z',
    }

    expect(() => commitToTimeline(timeline, draft)).toThrow(UnlockNotPermittedError)
    expect(timeline.state.locks[SOFA]).toBeDefined()
    expect(timeline.state.objects[SOFA]?.transform.position).toEqual([5, 0, 5])
    expect(timeline.log).toEqual([])
  })
})
