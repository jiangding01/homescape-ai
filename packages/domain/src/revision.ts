import type { DesignOperation } from './operations'

export interface RevisionProvenance {
  actor: 'user' | 'ai' | 'system'
  provider?: string
  model?: string
  schemaVersion?: string
  plannerVersion?: string
}

export interface DesignRevision {
  id: string
  projectId: string
  request?: string
  operations: DesignOperation[]
  parentRevisionId?: string
  provenance: RevisionProvenance
  createdAt: string
}
