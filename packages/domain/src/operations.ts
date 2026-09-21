import type { DesignScope } from './scope'

export interface OperationBase {
  id: string
  scope: DesignScope
  source: 'user' | 'ai' | 'planner' | 'rule' | 'system'
}

export type DesignOperation =
  | (OperationBase & { type: 'add_object'; category: string; requirements: Record<string, unknown> })
  | (OperationBase & { type: 'remove_object'; objectId: string })
  | (OperationBase & { type: 'replace_object'; objectId: string; requirements: Record<string, unknown> })
  | (OperationBase & { type: 'move_object'; objectId: string; position: readonly [number, number, number] })
  | (OperationBase & { type: 'rotate_object'; objectId: string; yaw: number })
  | (OperationBase & { type: 'set_material'; targetId: string; material: Record<string, unknown> })
  | (OperationBase & { type: 'set_style_intent'; targetId: string; style: Record<string, unknown> })
  | (OperationBase & { type: 'preserve'; targetId: string })
  | (OperationBase & { type: 'lock'; targetId: string })
  | (OperationBase & { type: 'unlock'; targetId: string })
