import type { ResolvedDesignMutation } from './mutations'
import type { DesignOperation } from './operations'

export type RevisionActor = 'user' | 'ai' | 'system'

export interface RevisionProvenance {
  actor: RevisionActor
  provider?: string
  model?: string
  schemaVersion?: string
  plannerVersion?: string
}

export interface DesignRevisionDraft {
  id: string
  projectId: string
  expectedParentRevisionId: string | null
  request?: string
  operations: DesignOperation[]
  mutations: ResolvedDesignMutation[]
  provenance: RevisionProvenance
  createdAt: string
}

/**
 * commit：普通提交；undo / redo：补偿式 Revision，mutations 为撤销（inverse）或重做的变更，
 * targetRevisionId 指向被撤销 / 重做的原始 commit Revision。Revision 日志只追加、不改写。
 */
export type DesignRevisionKind = 'commit' | 'undo' | 'redo'

export interface DesignRevision {
  id: string
  projectId: string
  kind: DesignRevisionKind
  targetRevisionId?: string
  parentRevisionId?: string
  request?: string
  operations: DesignOperation[]
  mutations: ResolvedDesignMutation[]
  inverseMutations: ResolvedDesignMutation[]
  provenance: RevisionProvenance
  stateVersionBefore: number
  stateVersionAfter: number
  createdAt: string
}
