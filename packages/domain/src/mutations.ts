import type { Vec3 } from '@homescape/spatial-model'
import type {
  DesignObject,
  DesignValueSource,
  ValueProvenance,
} from './state'

export type ResolvedDesignMutation =
  | {
      type: 'upsert_object'
      object: DesignObject
    }
  | {
      type: 'remove_object'
      objectId: string
    }
  | {
      type: 'move_object'
      objectId: string
      position: Vec3
    }
  | {
      type: 'rotate_object'
      objectId: string
      yaw: number
    }
  | {
      type: 'set_material'
      targetId: string
      material: Record<string, unknown>
      provenance?: ValueProvenance
    }
  | {
      type: 'remove_material'
      targetId: string
    }
  | {
      type: 'set_style_intent'
      targetId: string
      style: Record<string, unknown>
      provenance?: ValueProvenance
    }
  | {
      type: 'remove_style_intent'
      targetId: string
    }
  | {
      type: 'set_lock'
      targetId: string
      locked: boolean
      lockedBy: 'user' | 'system'
    }

export function getMutationTargetId(mutation: ResolvedDesignMutation) {
  switch (mutation.type) {
    case 'upsert_object':
      return mutation.object.id
    case 'remove_object':
    case 'move_object':
    case 'rotate_object':
      return mutation.objectId
    case 'set_material':
    case 'remove_material':
    case 'set_style_intent':
    case 'remove_style_intent':
    case 'set_lock':
      return mutation.targetId
  }
}

export function provenanceFromSource(
  source: DesignValueSource,
  revisionId: string,
): ValueProvenance {
  return {
    source,
    revisionId,
  }
}
