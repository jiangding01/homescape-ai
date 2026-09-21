import type { Vec3 } from '@homescape/spatial-model'

export type DesignValueSource =
  | 'user'
  | 'ai'
  | 'planner'
  | 'rule'
  | 'catalog'
  | 'system'

export interface ValueProvenance {
  source: DesignValueSource
  revisionId?: string
  provider?: string
  model?: string
  confidence?: number
}

export interface DesignTransform {
  position: Vec3
  yaw: number
}

export interface DesignObject {
  id: string
  assetId: string
  category: string
  transform: DesignTransform
  roomId?: string
  zoneId?: string
  dimensions?: Vec3
  variantId?: string
  metadata?: Record<string, string | number | boolean>
  provenance?: ValueProvenance
}

export interface MaterialAssignment {
  targetId: string
  material: Record<string, unknown>
  provenance?: ValueProvenance
}

export interface StyleIntentAssignment {
  targetId: string
  style: Record<string, unknown>
  provenance?: ValueProvenance
}

export interface DesignLock {
  targetId: string
  lockedBy: 'user' | 'system'
}

export interface DesignState {
  schemaVersion: string
  projectId: string
  spatialModelId: string
  version: number
  headRevisionId?: string
  objects: Record<string, DesignObject>
  materials: Record<string, MaterialAssignment>
  styleIntents: Record<string, StyleIntentAssignment>
  locks: Record<string, DesignLock>
}

export interface CreateInitialDesignStateInput {
  projectId: string
  spatialModelId: string
  objects?: readonly DesignObject[]
  materials?: readonly MaterialAssignment[]
  styleIntents?: readonly StyleIntentAssignment[]
  locks?: readonly DesignLock[]
}

function toUniqueRecord<T extends { targetId: string }>(
  values: readonly T[],
  kind: string,
): Record<string, T> {
  const record: Record<string, T> = {}

  for (const value of values) {
    if (record[value.targetId]) {
      throw new Error(kind + ' 存在重复 targetId：' + value.targetId)
    }

    record[value.targetId] = value
  }

  return record
}

function objectsToRecord(values: readonly DesignObject[]) {
  const record: Record<string, DesignObject> = {}

  for (const object of values) {
    if (record[object.id]) {
      throw new Error('DesignObject 存在重复 id：' + object.id)
    }

    record[object.id] = object
  }

  return record
}

export function createInitialDesignState(
  input: CreateInitialDesignStateInput,
): DesignState {
  return {
    schemaVersion: '0.1.0',
    projectId: input.projectId,
    spatialModelId: input.spatialModelId,
    version: 0,
    objects: objectsToRecord(input.objects ?? []),
    materials: toUniqueRecord(input.materials ?? [], 'MaterialAssignment'),
    styleIntents: toUniqueRecord(input.styleIntents ?? [], 'StyleIntentAssignment'),
    locks: toUniqueRecord(input.locks ?? [], 'DesignLock'),
  }
}
