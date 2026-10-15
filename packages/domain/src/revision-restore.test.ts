import { describe, expect, it } from 'vitest'
import type { ResolvedDesignMutation } from './mutations'
import type { DesignRevision } from './revision'
import {
  commitToTimeline,
  createRevisionTimeline,
  deriveUndoRedoStacks,
  redoTimeline,
  restoreRevisionTimeline,
  RevisionConflictError,
  undoTimeline,
  type RevisionTimeline,
} from './revision-engine'
import { createInitialDesignState, type DesignObject } from './state'

const PROJECT = 'project-test'

function object(id: string, x: number): DesignObject {
  return {
    id,
    assetId: 'asset-' + id,
    category: 'chair',
    transform: { position: [x, 0, 0], yaw: 0 },
  }
}

function initialState() {
  return createInitialDesignState({ projectId: PROJECT, spatialModelId: 'model-test' })
}

function commit(timeline: RevisionTimeline, id: string, mutations: ResolvedDesignMutation[]) {
  return commitToTimeline(timeline, {
    id,
    projectId: PROJECT,
    expectedParentRevisionId: timeline.state.headRevisionId ?? null,
    operations: [],
    mutations,
    provenance: { actor: 'user' },
    createdAt: '2026-01-01T00:00:00.000Z',
  }).timeline
}

function ids(revisions: readonly DesignRevision[]) {
  return revisions.map((revision) => revision.id)
}

function buildTimeline() {
  let timeline = createRevisionTimeline(initialState())
  timeline = commit(timeline, 'r1', [{ type: 'upsert_object', object: object('a', 0) }])
  timeline = commit(timeline, 'r2', [{ type: 'upsert_object', object: object('b', 1) }])
  timeline = commit(timeline, 'r3', [{ type: 'upsert_object', object: object('c', 2) }])
  timeline = undoTimeline(timeline, { revisionId: 'u1' }).timeline
  timeline = undoTimeline(timeline, { revisionId: 'u2' }).timeline
  timeline = redoTimeline(timeline, { revisionId: 'd1' }).timeline
  return timeline
}

describe('由 Revision 日志恢复时间线', () => {
  it('推导出的撤销 / 重做栈与内存时间线一致', () => {
    const timeline = buildTimeline()
    const stacks = deriveUndoRedoStacks(timeline.log)

    expect(ids(stacks.past)).toEqual(ids(timeline.past))
    expect(ids(stacks.future)).toEqual(ids(timeline.future))
    expect(ids(stacks.past)).toEqual(['r1', 'r2'])
    expect(ids(stacks.future)).toEqual(['r3'])
  })

  it('新 commit 清空重做栈', () => {
    let timeline = buildTimeline()
    timeline = commit(timeline, 'r4', [{ type: 'remove_object', objectId: 'a' }])
    const stacks = deriveUndoRedoStacks(timeline.log)

    expect(ids(stacks.past)).toEqual(['r1', 'r2', 'r4'])
    expect(stacks.future).toEqual([])
  })

  it('无快照时重放得到相同状态，有快照时校验一致后直接采用', () => {
    const timeline = buildTimeline()
    const replayed = restoreRevisionTimeline(initialState(), timeline.log)
    const fromSnapshot = restoreRevisionTimeline(initialState(), timeline.log, {
      headState: timeline.state,
    })

    expect(replayed.state).toEqual(timeline.state)
    expect(fromSnapshot.state).toEqual(timeline.state)
    expect(ids(fromSnapshot.past)).toEqual(ids(timeline.past))

    // 恢复出的时间线可继续撤销，结果与原时间线一致。
    const undone = undoTimeline(fromSnapshot, { revisionId: 'u3' })
    const expected = undoTimeline(timeline, { revisionId: 'u3' })
    expect(undone.timeline.state).toEqual(expected.timeline.state)
  })

  it('快照与日志不一致、或撤销目标错乱时拒绝恢复', () => {
    const timeline = buildTimeline()

    expect(() =>
      restoreRevisionTimeline(initialState(), timeline.log.slice(0, -1), {
        headState: timeline.state,
      }),
    ).toThrow(RevisionConflictError)

    const broken = timeline.log.map((revision) =>
      revision.id === 'u2' ? { ...revision, targetRevisionId: 'r3' } : revision,
    )
    expect(() => deriveUndoRedoStacks(broken)).toThrow(RevisionConflictError)
  })
})
