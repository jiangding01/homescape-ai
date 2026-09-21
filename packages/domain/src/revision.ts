import type { ResolvedDesignMutation } from './mutations'
import type { DesignOperation } from './operations'

export interface RevisionProvenance {
  actor: 'user' | 'ai' | 'system'
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

export interface DesignRevision {
  id: string
  projectId: string
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
