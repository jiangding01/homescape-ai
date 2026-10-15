import {
  getMutationTargetId,
  type ResolvedDesignMutation,
} from './mutations'
import type {
  DesignRevision,
  DesignRevisionDraft,
  DesignRevisionKind,
  RevisionActor,
  RevisionProvenance,
} from './revision'
import type {
  DesignObject,
  DesignState,
  MaterialAssignment,
  StyleIntentAssignment,
} from './state'

export class RevisionConflictError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RevisionConflictError'
  }
}

export class LockedTargetError extends Error {
  readonly targetId: string

  constructor(targetId: string) {
    super('目标已锁定，不能修改：' + targetId)
    this.name = 'LockedTargetError'
    this.targetId = targetId
  }
}

export class UnlockNotPermittedError extends Error {
  readonly targetId: string
  readonly actor: RevisionActor

  constructor(targetId: string, actor: RevisionActor) {
    super('只有用户本人可以解除锁定，已拒绝 ' + actor + ' 的解锁：' + targetId)
    this.name = 'UnlockNotPermittedError'
    this.targetId = targetId
    this.actor = actor
  }
}

export class InvalidDesignMutationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidDesignMutationError'
  }
}

export interface ApplyMutationOptions {
  /**
   * 发起这批 mutation 的 actor。解锁（set_lock locked=false）只允许 'user'。
   * 缺省按最小权限视为 'system'。
   */
  actor?: RevisionActor
}

export interface ApplyMutationResult {
  state: DesignState
  inverseMutations: ResolvedDesignMutation[]
}

function cloneState(state: DesignState): DesignState {
  return {
    ...state,
    objects: { ...state.objects },
    materials: { ...state.materials },
    styleIntents: { ...state.styleIntents },
    locks: { ...state.locks },
  }
}

function cloneObject(object: DesignObject): DesignObject {
  return {
    ...object,
    transform: {
      position: [...object.transform.position] as DesignObject['transform']['position'],
      yaw: object.transform.yaw,
    },
    ...(object.metadata ? { metadata: { ...object.metadata } } : {}),
    ...(object.provenance ? { provenance: { ...object.provenance } } : {}),
  }
}

function assertMutationAllowed(
  state: DesignState,
  mutation: ResolvedDesignMutation,
  actor: RevisionActor,
) {
  if (mutation.type === 'set_lock') {
    // 加锁对任何 actor 开放（AI 可代用户加保护）；解锁必须由用户本人发起。
    if (!mutation.locked && actor !== 'user') {
      throw new UnlockNotPermittedError(mutation.targetId, actor)
    }

    return
  }

  const targetId = getMutationTargetId(mutation)

  if (state.locks[targetId]) {
    throw new LockedTargetError(targetId)
  }
}

function materialInverse(
  assignment: MaterialAssignment | undefined,
  targetId: string,
): ResolvedDesignMutation {
  if (!assignment) {
    return {
      type: 'remove_material',
      targetId,
    }
  }

  return {
    type: 'set_material',
    targetId,
    material: { ...assignment.material },
    ...(assignment.provenance
      ? { provenance: { ...assignment.provenance } }
      : {}),
  }
}

function styleInverse(
  assignment: StyleIntentAssignment | undefined,
  targetId: string,
): ResolvedDesignMutation {
  if (!assignment) {
    return {
      type: 'remove_style_intent',
      targetId,
    }
  }

  return {
    type: 'set_style_intent',
    targetId,
    style: { ...assignment.style },
    ...(assignment.provenance
      ? { provenance: { ...assignment.provenance } }
      : {}),
  }
}

function applyOneMutation(
  state: DesignState,
  mutation: ResolvedDesignMutation,
  actor: RevisionActor,
): ResolvedDesignMutation {
  assertMutationAllowed(state, mutation, actor)

  switch (mutation.type) {
    case 'upsert_object': {
      const previous = state.objects[mutation.object.id]
      state.objects[mutation.object.id] = cloneObject(mutation.object)

      return previous
        ? {
            type: 'upsert_object',
            object: cloneObject(previous),
          }
        : {
            type: 'remove_object',
            objectId: mutation.object.id,
          }
    }

    case 'remove_object': {
      const previous = state.objects[mutation.objectId]

      if (!previous) {
        throw new InvalidDesignMutationError(
          '无法删除不存在的对象：' + mutation.objectId,
        )
      }

      delete state.objects[mutation.objectId]

      return {
        type: 'upsert_object',
        object: cloneObject(previous),
      }
    }

    case 'move_object': {
      const object = state.objects[mutation.objectId]

      if (!object) {
        throw new InvalidDesignMutationError(
          '无法移动不存在的对象：' + mutation.objectId,
        )
      }

      const previousPosition = object.transform.position
      state.objects[mutation.objectId] = {
        ...object,
        transform: {
          ...object.transform,
          position: [...mutation.position] as DesignObject['transform']['position'],
        },
      }

      return {
        type: 'move_object',
        objectId: mutation.objectId,
        position: [...previousPosition] as DesignObject['transform']['position'],
      }
    }

    case 'rotate_object': {
      const object = state.objects[mutation.objectId]

      if (!object) {
        throw new InvalidDesignMutationError(
          '无法旋转不存在的对象：' + mutation.objectId,
        )
      }

      const previousYaw = object.transform.yaw
      state.objects[mutation.objectId] = {
        ...object,
        transform: {
          ...object.transform,
          yaw: mutation.yaw,
        },
      }

      return {
        type: 'rotate_object',
        objectId: mutation.objectId,
        yaw: previousYaw,
      }
    }

    case 'set_material': {
      const previous = state.materials[mutation.targetId]
      state.materials[mutation.targetId] = {
        targetId: mutation.targetId,
        material: { ...mutation.material },
        ...(mutation.provenance
          ? { provenance: { ...mutation.provenance } }
          : {}),
      }

      return materialInverse(previous, mutation.targetId)
    }

    case 'remove_material': {
      const previous = state.materials[mutation.targetId]
      delete state.materials[mutation.targetId]
      return materialInverse(previous, mutation.targetId)
    }

    case 'set_style_intent': {
      const previous = state.styleIntents[mutation.targetId]
      state.styleIntents[mutation.targetId] = {
        targetId: mutation.targetId,
        style: { ...mutation.style },
        ...(mutation.provenance
          ? { provenance: { ...mutation.provenance } }
          : {}),
      }

      return styleInverse(previous, mutation.targetId)
    }

    case 'remove_style_intent': {
      const previous = state.styleIntents[mutation.targetId]
      delete state.styleIntents[mutation.targetId]
      return styleInverse(previous, mutation.targetId)
    }

    case 'set_lock': {
      const previous = state.locks[mutation.targetId]

      if (mutation.locked) {
        state.locks[mutation.targetId] = {
          targetId: mutation.targetId,
          lockedBy: mutation.lockedBy,
        }
      } else {
        delete state.locks[mutation.targetId]
      }

      return previous
        ? {
            type: 'set_lock',
            targetId: mutation.targetId,
            locked: true,
            lockedBy: previous.lockedBy,
          }
        : {
            type: 'set_lock',
            targetId: mutation.targetId,
            locked: false,
            lockedBy: mutation.lockedBy,
          }
    }
  }
}

export function applyResolvedMutations(
  baseState: DesignState,
  mutations: readonly ResolvedDesignMutation[],
  options: ApplyMutationOptions = {},
): ApplyMutationResult {
  const state = cloneState(baseState)
  const inverseMutations: ResolvedDesignMutation[] = []
  const actor = options.actor ?? 'system'

  for (const mutation of mutations) {
    const inverse = applyOneMutation(state, mutation, actor)
    inverseMutations.unshift(inverse)
  }

  return {
    state,
    inverseMutations,
  }
}

export function commitDesignRevision(
  state: DesignState,
  draft: DesignRevisionDraft,
) {
  if (draft.projectId !== state.projectId) {
    throw new RevisionConflictError(
      'Revision projectId 与 DesignState 不一致',
    )
  }

  const currentHead = state.headRevisionId ?? null

  if (draft.expectedParentRevisionId !== currentHead) {
    throw new RevisionConflictError(
      'Revision 基于过期版本。expected=' +
        String(draft.expectedParentRevisionId) +
        ', current=' +
        String(currentHead),
    )
  }

  if (draft.mutations.length === 0) {
    throw new InvalidDesignMutationError(
      '没有产生状态变化的请求不应提交 DesignRevision',
    )
  }

  return appendRevision(state, {
    id: draft.id,
    kind: 'commit',
    ...(draft.request ? { request: draft.request } : {}),
    operations: draft.operations,
    mutations: draft.mutations,
    provenance: draft.provenance,
    createdAt: draft.createdAt,
  })
}

interface AppendRevisionInput {
  id: string
  kind: DesignRevisionKind
  targetRevisionId?: string
  request?: string
  operations: DesignRevision['operations']
  mutations: readonly ResolvedDesignMutation[]
  provenance: RevisionProvenance
  createdAt: string
}

/**
 * 以当前 head 为 parent 追加一条 Revision：正常走锁与解锁权限检查，version 恰好 +1。
 * commit / undo / redo 共用这一条路径，保证 Revision 日志可被 replayRevisions 精确重放。
 */
function appendRevision(state: DesignState, input: AppendRevisionInput) {
  const applied = applyResolvedMutations(state, input.mutations, {
    actor: input.provenance.actor,
  })
  const nextState = applied.state
  nextState.version = state.version + 1
  nextState.headRevisionId = input.id

  const revision: DesignRevision = {
    id: input.id,
    projectId: state.projectId,
    kind: input.kind,
    ...(input.targetRevisionId
      ? { targetRevisionId: input.targetRevisionId }
      : {}),
    ...(state.headRevisionId
      ? { parentRevisionId: state.headRevisionId }
      : {}),
    ...(input.request ? { request: input.request } : {}),
    operations: [...input.operations],
    mutations: [...input.mutations],
    inverseMutations: applied.inverseMutations,
    provenance: { ...input.provenance },
    stateVersionBefore: state.version,
    stateVersionAfter: nextState.version,
    createdAt: input.createdAt,
  }

  return {
    state: nextState,
    revision,
  }
}

/**
 * - log：完整、只追加的 Revision 日志（commit + undo/redo 补偿 Revision），
 *   replayRevisions(initialState, log) 必须得到与 state 完全相同的结果（含 version）。
 * - past / future：撤销栈语义，只存放原始 commit Revision；undo 弹出 past 顶部压入 future，
 *   redo 反之；新的 commit 清空 future。
 */
export interface RevisionTimeline {
  state: DesignState
  log: readonly DesignRevision[]
  past: readonly DesignRevision[]
  future: readonly DesignRevision[]
}

export type TimelineChangeResult =
  | {
      changed: true
      timeline: RevisionTimeline
      /** 本次新追加的 undo / redo 补偿 Revision。 */
      revision: DesignRevision
      /** 被撤销 / 重做的原始 commit Revision。 */
      targetRevision: DesignRevision
    }
  | {
      changed: false
      timeline: RevisionTimeline
    }

export interface TimelineChangeOptions {
  /** 补偿 Revision 的 id；缺省按 `<kind>-<targetId>-v<新版本号>` 生成（同一 timeline 内唯一）。 */
  revisionId?: string
  /** 发起 undo / redo 的 actor，缺省为 'user'（Undo / Redo 按钮）。 */
  actor?: RevisionActor
  createdAt?: string
}

export function createRevisionTimeline(
  initialState: DesignState,
): RevisionTimeline {
  return {
    state: cloneState(initialState),
    log: [],
    past: [],
    future: [],
  }
}

export function commitToTimeline(
  timeline: RevisionTimeline,
  draft: DesignRevisionDraft,
) {
  const committed = commitDesignRevision(timeline.state, draft)

  return {
    timeline: {
      state: committed.state,
      log: [...timeline.log, committed.revision],
      past: [...timeline.past, committed.revision],
      future: [],
    } satisfies RevisionTimeline,
    revision: committed.revision,
  }
}

function appendCompensatingRevision(
  timeline: RevisionTimeline,
  kind: 'undo' | 'redo',
  target: DesignRevision,
  options: TimelineChangeOptions,
) {
  const mutations = kind === 'undo' ? target.inverseMutations : target.mutations

  return appendRevision(timeline.state, {
    id:
      options.revisionId ??
      kind + '-' + target.id + '-v' + String(timeline.state.version + 1),
    kind,
    targetRevisionId: target.id,
    operations: [],
    mutations,
    provenance: { actor: options.actor ?? 'user' },
    createdAt: options.createdAt ?? new Date().toISOString(),
  })
}

export function undoTimeline(
  timeline: RevisionTimeline,
  options: TimelineChangeOptions = {},
): TimelineChangeResult {
  const target = timeline.past[timeline.past.length - 1]

  if (!target) {
    return {
      changed: false,
      timeline,
    }
  }

  const appended = appendCompensatingRevision(timeline, 'undo', target, options)

  return {
    changed: true,
    revision: appended.revision,
    targetRevision: target,
    timeline: {
      state: appended.state,
      log: [...timeline.log, appended.revision],
      past: timeline.past.slice(0, -1),
      future: [target, ...timeline.future],
    },
  }
}

export function redoTimeline(
  timeline: RevisionTimeline,
  options: TimelineChangeOptions = {},
): TimelineChangeResult {
  const target = timeline.future[0]

  if (!target) {
    return {
      changed: false,
      timeline,
    }
  }

  const appended = appendCompensatingRevision(timeline, 'redo', target, options)

  return {
    changed: true,
    revision: appended.revision,
    targetRevision: target,
    timeline: {
      state: appended.state,
      log: [...timeline.log, appended.revision],
      past: [...timeline.past, target],
      future: timeline.future.slice(1),
    },
  }
}

/**
 * 按完整 Revision 日志（含 undo / redo）重放。与提交时走同样的锁与解锁权限检查，
 * 并校验 parent 链与 stateVersionBefore / After，任何断裂都会抛 RevisionConflictError。
 */
export function replayRevisions(
  initialState: DesignState,
  revisions: readonly DesignRevision[],
) {
  let state = cloneState(initialState)

  for (const revision of revisions) {
    const expectedParent = revision.parentRevisionId ?? null
    const currentHead = state.headRevisionId ?? null

    if (
      expectedParent !== currentHead ||
      revision.stateVersionBefore !== state.version
    ) {
      throw new RevisionConflictError(
        'Replay 检测到断裂的 Revision 链：' + revision.id,
      )
    }

    const applied = applyResolvedMutations(state, revision.mutations, {
      actor: revision.provenance.actor,
    })
    state = applied.state
    state.version += 1
    state.headRevisionId = revision.id

    if (state.version !== revision.stateVersionAfter) {
      throw new RevisionConflictError(
        'Replay 版本号与 Revision 记录不一致：' + revision.id,
      )
    }
  }

  return state
}

/**
 * 由只追加的 Revision 日志推导撤销 / 重做栈（与 commitToTimeline / undoTimeline / redoTimeline
 * 的栈语义一致），因此持久化时只需保存日志，无需单独存储 past / future。
 * 日志中 undo / redo 的目标与栈顶不一致时抛 RevisionConflictError。
 */
export function deriveUndoRedoStacks(log: readonly DesignRevision[]) {
  const past: DesignRevision[] = []
  let future: DesignRevision[] = []

  for (const revision of log) {
    if (revision.kind === 'commit') {
      past.push(revision)
      future = []
      continue
    }

    if (revision.kind === 'undo') {
      const target = past[past.length - 1]

      if (!target || target.id !== revision.targetRevisionId) {
        throw new RevisionConflictError(
          'Undo Revision 的目标与撤销栈不一致：' + revision.id,
        )
      }

      past.pop()
      future = [target, ...future]
      continue
    }

    const target = future[0]

    if (!target || target.id !== revision.targetRevisionId) {
      throw new RevisionConflictError(
        'Redo Revision 的目标与重做栈不一致：' + revision.id,
      )
    }

    future = future.slice(1)
    past.push(target)
  }

  return { past, future }
}

export interface RestoreRevisionTimelineOptions {
  /**
   * 日志末尾的状态快照。提供时直接采用（须与日志 head / version 一致），
   * 否则由 initialState 重放日志得到。
   */
  headState?: DesignState
}

/** 由初始状态 + 完整 Revision 日志恢复 RevisionTimeline（持久化后的读取路径）。 */
export function restoreRevisionTimeline(
  initialState: DesignState,
  log: readonly DesignRevision[],
  options: RestoreRevisionTimelineOptions = {},
): RevisionTimeline {
  const { past, future } = deriveUndoRedoStacks(log)
  let state: DesignState

  if (options.headState) {
    const last = log[log.length - 1]
    const expectedHead = last ? last.id : (initialState.headRevisionId ?? null)
    const expectedVersion = last ? last.stateVersionAfter : initialState.version

    if (
      (options.headState.headRevisionId ?? null) !== expectedHead ||
      options.headState.version !== expectedVersion
    ) {
      throw new RevisionConflictError('状态快照与 Revision 日志不一致')
    }

    state = cloneState(options.headState)
  } else {
    state = replayRevisions(initialState, log)
  }

  return {
    state,
    log: [...log],
    past,
    future,
  }
}
