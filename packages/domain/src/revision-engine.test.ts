import { describe, expect, it } from 'vitest'
import type { ResolvedDesignMutation } from './mutations'
import type { RevisionActor } from './revision'
import {
  applyResolvedMutations,
  commitToTimeline,
  createRevisionTimeline,
  LockedTargetError,
  redoTimeline,
  replayRevisions,
  undoTimeline,
  UnlockNotPermittedError,
  type RevisionTimeline,
} from './revision-engine'
import { createInitialDesignState, type DesignObject, type DesignState } from './state'

const PROJECT = 'project-test'

function object(id: string, x: number): DesignObject {
  return {
    id,
    assetId: 'asset-' + id,
    category: 'chair',
    transform: { position: [x, 0, 0], yaw: 0 },
  }
}

function initialState(): DesignState {
  return createInitialDesignState({
    projectId: PROJECT,
    spatialModelId: 'model-test',
    objects: [object('a', 0), object('b', 1), object('c', 2)],
  })
}

function commit(
  timeline: RevisionTimeline,
  id: string,
  mutations: ResolvedDesignMutation[],
  actor: RevisionActor = 'user',
) {
  return commitToTimeline(timeline, {
    id,
    projectId: PROJECT,
    expectedParentRevisionId: timeline.state.headRevisionId ?? null,
    operations: [],
    mutations,
    provenance: { actor },
    createdAt: '2026-01-01T00:00:00.000Z',
  }).timeline
}

function expectReplayMatches(initial: DesignState, timeline: RevisionTimeline) {
  const replayed = replayRevisions(initial, timeline.log)
  expect(replayed).toEqual(timeline.state)
  expect(replayed.version).toBe(timeline.state.version)
  expect(timeline.state.version).toBe(initial.version + timeline.log.length)
}

describe('撤销 / 重做为补偿式 Revision', () => {
  it('commit → undo → redo 后 replay 与 timeline 的 state、version 完全一致', () => {
    const initial = initialState()
    let timeline = createRevisionTimeline(initial)
    timeline = commit(timeline, 'r1', [{ type: 'move_object', objectId: 'a', position: [3, 0, 3] }])

    const undone = undoTimeline(timeline, { createdAt: '2026-01-01T00:01:00.000Z' })
    expect(undone.changed).toBe(true)
    timeline = undone.timeline
    expect(timeline.state.objects.a?.transform.position).toEqual([0, 0, 0])

    const redone = redoTimeline(timeline, { createdAt: '2026-01-01T00:02:00.000Z' })
    expect(redone.changed).toBe(true)
    timeline = redone.timeline
    expect(timeline.state.objects.a?.transform.position).toEqual([3, 0, 3])

    expect(timeline.state.version).toBe(3)
    expect(timeline.log.map((revision) => revision.kind)).toEqual(['commit', 'undo', 'redo'])
    expect(timeline.log.map((revision) => revision.targetRevisionId)).toEqual([undefined, 'r1', 'r1'])
    expect(timeline.log.map((revision) => revision.parentRevisionId)).toEqual([
      undefined,
      'r1',
      timeline.log[1]!.id,
    ])
    expect(timeline.log.map((revision) => revision.stateVersionAfter)).toEqual([1, 2, 3])
    expect(timeline.state.headRevisionId).toBe(timeline.log[2]!.id)
    expect(timeline.log[1]!.provenance.actor).toBe('user')
    // 撤销栈语义不变：past / future 只含原始 commit。
    expect(timeline.past.map((revision) => revision.id)).toEqual(['r1'])
    expect(timeline.future).toEqual([])

    expectReplayMatches(initial, timeline)
  })

  it('undo / redo 后的新 commit 仍以当前 head 为 parent 并清空 future', () => {
    const initial = initialState()
    let timeline = createRevisionTimeline(initial)
    timeline = commit(timeline, 'r1', [{ type: 'rotate_object', objectId: 'b', yaw: 1 }])
    timeline = undoTimeline(timeline).timeline
    timeline = commit(timeline, 'r2', [{ type: 'remove_object', objectId: 'c' }])

    expect(timeline.future).toEqual([])
    expect(timeline.past.map((revision) => revision.id)).toEqual(['r2'])
    expect(timeline.log.at(-1)?.parentRevisionId).toBe(timeline.log[1]!.id)
    expectReplayMatches(initial, timeline)
  })

  it('对已加锁对象，撤销其之前的移动会被拒绝且 timeline 不变', () => {
    const initial = initialState()
    let timeline = createRevisionTimeline(initial)
    timeline = commit(timeline, 'r1', [{ type: 'move_object', objectId: 'a', position: [5, 0, 5] }])
    // 锁来自撤销栈之外（例如系统 / 其他协作者施加的锁）。
    const locked = applyResolvedMutations(
      timeline.state,
      [{ type: 'set_lock', targetId: 'a', locked: true, lockedBy: 'system' }],
      { actor: 'system' },
    ).state
    timeline = { ...timeline, state: locked }

    expect(() => undoTimeline(timeline)).toThrow(LockedTargetError)
    expect(timeline.state.objects.a?.transform.position).toEqual([5, 0, 5])
    expect(timeline.log).toHaveLength(1)
  })

  it('撤销对象本身就是 set_lock 变更时允许，随后可继续撤销移动', () => {
    const initial = initialState()
    let timeline = createRevisionTimeline(initial)
    timeline = commit(timeline, 'r1', [{ type: 'move_object', objectId: 'a', position: [5, 0, 5] }])
    timeline = commit(timeline, 'r2', [
      { type: 'set_lock', targetId: 'a', locked: true, lockedBy: 'user' },
    ])

    expect(() =>
      commit(timeline, 'r3', [{ type: 'move_object', objectId: 'a', position: [1, 0, 1] }]),
    ).toThrow(LockedTargetError)

    timeline = undoTimeline(timeline).timeline
    expect(timeline.state.locks.a).toBeUndefined()
    timeline = undoTimeline(timeline).timeline
    expect(timeline.state.objects.a?.transform.position).toEqual([0, 0, 0])
    timeline = redoTimeline(timeline).timeline
    timeline = redoTimeline(timeline).timeline
    expect(timeline.state.locks.a).toEqual({ targetId: 'a', lockedBy: 'user' })
    expectReplayMatches(initial, timeline)
  })

  it('非 user actor 撤销用户的加锁（即解锁）会被拒绝', () => {
    let timeline = createRevisionTimeline(initialState())
    timeline = commit(timeline, 'r1', [
      { type: 'set_lock', targetId: 'a', locked: true, lockedBy: 'user' },
    ])

    expect(() => undoTimeline(timeline, { actor: 'ai' })).toThrow(UnlockNotPermittedError)
    expect(undoTimeline(timeline, { actor: 'user' }).timeline.state.locks.a).toBeUndefined()
  })
})

describe('Revision 引擎的解锁权限', () => {
  const unlockA: ResolvedDesignMutation = {
    type: 'set_lock',
    targetId: 'a',
    locked: false,
    lockedBy: 'user',
  }

  function lockedTimeline() {
    return commit(createRevisionTimeline(initialState()), 'r-lock', [
      { type: 'set_lock', targetId: 'a', locked: true, lockedBy: 'user' },
    ])
  }

  it.each(['ai', 'system'] as const)('%s actor 的解锁 mutation 被拒绝', (actor) => {
    expect(() => commit(lockedTimeline(), 'r-unlock', [unlockA], actor)).toThrow(
      UnlockNotPermittedError,
    )
  })

  it('user actor 解锁成功', () => {
    const timeline = commit(lockedTimeline(), 'r-unlock', [unlockA], 'user')
    expect(timeline.state.locks.a).toBeUndefined()
  })

  it('AI actor 加锁仍被允许', () => {
    const timeline = commit(
      createRevisionTimeline(initialState()),
      'r-ai-lock',
      [{ type: 'set_lock', targetId: 'b', locked: true, lockedBy: 'user' }],
      'ai',
    )
    expect(timeline.state.locks.b).toBeDefined()
  })

  it('applyResolvedMutations 缺省 actor 按最小权限处理，不能解锁', () => {
    const state = lockedTimeline().state
    expect(() => applyResolvedMutations(state, [unlockA])).toThrow(UnlockNotPermittedError)
  })
})

describe('随机操作序列的 replay 一致性（小规模属性测试）', () => {
  function mulberry32(seed: number) {
    let value = seed >>> 0
    return () => {
      value = (value + 0x6d2b79f5) >>> 0
      let t = value
      t = Math.imul(t ^ (t >>> 15), t | 1)
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
  }

  function randomMutation(random: () => number): ResolvedDesignMutation {
    const targetId = ['a', 'b', 'c'][Math.floor(random() * 3)]!
    const roll = random()

    if (roll < 0.3) {
      return {
        type: 'move_object',
        objectId: targetId,
        position: [Math.round(random() * 10), 0, Math.round(random() * 10)],
      }
    }
    if (roll < 0.45) return { type: 'rotate_object', objectId: targetId, yaw: random() * 6 }
    if (roll < 0.6) return { type: 'set_material', targetId, material: { color: random() } }
    if (roll < 0.7) return { type: 'remove_material', targetId }
    if (roll < 0.85) return { type: 'set_lock', targetId, locked: true, lockedBy: 'user' }
    return { type: 'set_lock', targetId, locked: false, lockedBy: 'user' }
  }

  it('200 组随机序列：replay(log) 始终等于 timeline.state，用户 undo/redo 从不被拒绝', () => {
    for (let seed = 1; seed <= 200; seed += 1) {
      const random = mulberry32(seed)
      const initial = initialState()
      let timeline = createRevisionTimeline(initial)
      let commitCount = 0

      for (let step = 0; step < 30; step += 1) {
        const roll = random()

        if (roll < 0.5) {
          const mutations = Array.from({ length: 1 + Math.floor(random() * 3) }, () =>
            randomMutation(random),
          )
          const actor: RevisionActor = random() < 0.5 ? 'user' : 'ai'

          try {
            commitCount += 1
            timeline = commit(timeline, 'r' + commitCount, mutations, actor)
          } catch (error) {
            // 被锁或解锁权限拒绝的提交不得改变 timeline。
            expect(
              error instanceof LockedTargetError || error instanceof UnlockNotPermittedError,
            ).toBe(true)
          }
        } else if (roll < 0.8) {
          timeline = undoTimeline(timeline).timeline
        } else {
          timeline = redoTimeline(timeline).timeline
        }

        expect(replayRevisions(initial, timeline.log)).toEqual(timeline.state)
      }

      expectReplayMatches(initial, timeline)

      // 全部撤销后回到初始内容（version 仍单调递增）。
      while (timeline.past.length > 0) timeline = undoTimeline(timeline).timeline
      expect(timeline.state.objects).toEqual(initial.objects)
      expect(timeline.state.materials).toEqual(initial.materials)
      expect(timeline.state.locks).toEqual(initial.locks)
      expectReplayMatches(initial, timeline)
    }
  })
})
