import type {
  CommitRevisionResponse,
  DesignInterpretation,
  ProjectDetail,
  RevisionSummary,
} from '@homescape/contracts'
import { createInitialDesignState, type DesignObject } from '@homescape/domain'
import { sampleApartment } from '@homescape/spatial-model'

export const SOFA: DesignObject = {
  id: 'obj-sofa',
  assetId: 'asset-sofa',
  category: 'sofa',
  transform: { position: [1, 0, 1], yaw: 0 },
  metadata: { catalogName: '三人沙发' },
}

export function makeProject(
  overrides: {
    id?: string
    head?: string | null
    objects?: DesignObject[]
    spatialModelVersionId?: string
    canUndo?: boolean
    canRedo?: boolean
    revisionCount?: number
    updatedAt?: string
  } = {},
): ProjectDetail {
  const id = overrides.id ?? 'project-1'
  const versionId = overrides.spatialModelVersionId ?? 'smv-1'
  const head = overrides.head === undefined ? null : overrides.head
  const state = createInitialDesignState({
    projectId: id,
    spatialModelId: versionId,
    objects: overrides.objects ?? [],
  })

  return {
    id,
    name: '测试项目',
    createdAt: '2026-10-15T00:00:00.000Z',
    updatedAt: overrides.updatedAt ?? '2026-10-15T00:00:00.000Z',
    spatialModel: {
      id: versionId,
      projectId: id,
      schemaVersion: sampleApartment.schemaVersion,
      createdAt: '2026-10-15T00:00:00.000Z',
      model: sampleApartment,
    },
    timelineId: 'timeline-' + versionId,
    state: head ? { ...state, headRevisionId: head } : state,
    headRevisionId: head,
    canUndo: overrides.canUndo ?? head !== null,
    canRedo: overrides.canRedo ?? false,
    revisionCount: overrides.revisionCount ?? (head ? 1 : 0),
    recentRevisions: [],
  }
}

export function makeRevision(id: string): RevisionSummary {
  return {
    id,
    seq: 1,
    kind: 'commit',
    parentRevisionId: null,
    operationCount: 1,
    mutationCount: 1,
    actor: 'user',
    stateVersionAfter: 1,
    createdAt: '2026-10-15T00:00:00.000Z',
  }
}

export function makeCommitResponse(project: ProjectDetail): CommitRevisionResponse {
  return {
    project,
    revision: makeRevision(project.headRevisionId ?? 'rev'),
    operationIdMap: {},
    planner: { violations: [], decisions: [] },
  }
}

export function makeInterpretation(
  overrides: Partial<DesignInterpretation> = {},
): DesignInterpretation {
  const signal = { value: 'x', confidence: 0.9 }

  return {
    status: 'ready',
    message: 'ok',
    operations: [],
    decisions: {
      intent: signal,
      scope: signal,
      target: signal,
      category: signal,
      size: signal,
      color: signal,
      seats: signal,
      style: signal,
      preserveOthers: 1,
    },
    meta: { provider: 'test-provider', model: 'test-model', latencyMs: 5 },
    ...overrides,
  }
}
