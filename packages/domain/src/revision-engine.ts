import {
  getMutationTargetId,
  type ResolvedDesignMutation,
} from './mutations'
import type {
  DesignRevision,
  DesignRevisionDraft,
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

export class InvalidDesignMutationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidDesignMutationError'
  }
}

export interface ApplyMutationOptions {
  bypassLocks?: boolean
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

function assertTargetUnlocked(
  state: DesignState,
  mutation: ResolvedDesignMutation,
  bypassLocks: boolean,
) {
  if (bypassLocks || mutation.type === 'set_lock') return

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
  bypassLocks: boolean,
): ResolvedDesignMutation {
  assertTargetUnlocked(state, mutation, bypassLocks)

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
  const bypassLocks = options.bypassLocks ?? false

  for (const mutation of mutations) {
    const inverse = applyOneMutation(state, mutation, bypassLocks)
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

  const applied = applyResolvedMutations(state, draft.mutations)
  const nextState = applied.state
  nextState.version = state.version + 1
  nextState.headRevisionId = draft.id

  const revision: DesignRevision = {
    id: draft.id,
    projectId: draft.projectId,
    ...(state.headRevisionId
      ? { parentRevisionId: state.headRevisionId }
      : {}),
    ...(draft.request ? { request: draft.request } : {}),
    operations: [...draft.operations],
    mutations: [...draft.mutations],
    inverseMutations: applied.inverseMutations,
    provenance: { ...draft.provenance },
    stateVersionBefore: state.version,
    stateVersionAfter: nextState.version,
    createdAt: draft.createdAt,
  }

  return {
    state: nextState,
    revision,
  }
}

export interface RevisionTimeline {
  state: DesignState
  past: readonly DesignRevision[]
  future: readonly DesignRevision[]
}

export type TimelineChangeResult =
  | {
      changed: true
      timeline: RevisionTimeline
      revision: DesignRevision
    }
  | {
      changed: false
      timeline: RevisionTimeline
    }

export function createRevisionTimeline(
  initialState: DesignState,
): RevisionTimeline {
  return {
    state: cloneState(initialState),
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
      past: [...timeline.past, committed.revision],
      future: [],
    } satisfies RevisionTimeline,
    revision: committed.revision,
  }
}

export function undoTimeline(
  timeline: RevisionTimeline,
): TimelineChangeResult {
  const revision = timeline.past[timeline.past.length - 1]

  if (!revision) {
    return {
      changed: false,
      timeline,
    }
  }

  const applied = applyResolvedMutations(
    timeline.state,
    revision.inverseMutations,
    { bypassLocks: true },
  )
  const state = applied.state
  state.version = timeline.state.version + 1

  if (revision.parentRevisionId) {
    state.headRevisionId = revision.parentRevisionId
  } else {
    delete state.headRevisionId
  }

  return {
    changed: true,
    revision,
    timeline: {
      state,
      past: timeline.past.slice(0, -1),
      future: [revision, ...timeline.future],
    },
  }
}

export function redoTimeline(
  timeline: RevisionTimeline,
): TimelineChangeResult {
  const revision = timeline.future[0]

  if (!revision) {
    return {
      changed: false,
      timeline,
    }
  }

  const expectedParent = revision.parentRevisionId ?? null
  const currentHead = timeline.state.headRevisionId ?? null

  if (expectedParent !== currentHead) {
    throw new RevisionConflictError(
      '无法 Redo：Revision parent 与当前 head 不一致',
    )
  }

  const applied = applyResolvedMutations(
    timeline.state,
    revision.mutations,
    { bypassLocks: true },
  )
  const state = applied.state
  state.version = timeline.state.version + 1
  state.headRevisionId = revision.id

  return {
    changed: true,
    revision,
    timeline: {
      state,
      past: [...timeline.past, revision],
      future: timeline.future.slice(1),
    },
  }
}

export function replayRevisions(
  initialState: DesignState,
  revisions: readonly DesignRevision[],
) {
  let state = cloneState(initialState)

  for (const revision of revisions) {
    const expectedParent = revision.parentRevisionId ?? null
    const currentHead = state.headRevisionId ?? null

    if (expectedParent !== currentHead) {
      throw new RevisionConflictError(
        'Replay 检测到断裂的 Revision 链：' + revision.id,
      )
    }

    const applied = applyResolvedMutations(
      state,
      revision.mutations,
      { bypassLocks: true },
    )
    state = applied.state
    state.version += 1
    state.headRevisionId = revision.id
  }

  return state
}
