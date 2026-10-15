import {
  RECENT_REVISION_LIMIT,
  type CommitRevisionRequest,
  type CommitRevisionResponse,
  type CreateProjectRequest,
  type ProjectDetail,
  type ProjectListResponse,
  type RevisionSummary,
  type TimelineChangeResponse,
  type Violation,
} from '@homescape/contracts'
import {
  commitToTimeline,
  createInitialDesignState,
  DESIGN_STATE_SCHEMA_VERSION,
  InvalidDesignMutationError,
  LockedTargetError,
  redoTimeline,
  restoreRevisionTimeline,
  RevisionConflictError,
  undoTimeline,
  UnlockNotPermittedError,
  type DesignOperation,
  type DesignRevision,
  type DesignState,
  type RevisionActor,
  type RevisionTimeline,
} from '@homescape/domain'
import type { SpatialPlanner } from '@homescape/planner'
import {
  sampleApartment,
  validateHomeSpatialModel,
  type HomeSpatialModel,
} from '@homescape/spatial-model'
import { ApiHttpError } from '../errors'
import { uuidv7, type IdGenerator } from '../ids'
import type { JsonMigrationRegistry } from '../storage/json-migrations'
import { createDefaultJsonMigrations } from '../storage/json-migrations'
import type {
  DesignStore,
  ProjectRecord,
  RevisionRecord,
  SpatialModelRecord,
  TimelineRecord,
} from '../storage/types'

export const PLANNER_VERSION = 'rule-based-v0.1'
export const SAMPLE_PROJECT_NAME = '示例项目'
export const DEFAULT_PROJECT_NAME = '未命名项目'

export interface ProjectServiceOptions {
  store: DesignStore
  planner: SpatialPlanner
  migrations?: JsonMigrationRegistry
  createId?: IdGenerator
  now?: () => string
}

interface LoadedProject {
  project: ProjectRecord
  spatialModel: SpatialModelRecord
  timelineRecord: TimelineRecord
  records: RevisionRecord[]
  timeline: RevisionTimeline
}

function headOf(timeline: RevisionTimeline) {
  return timeline.state.headRevisionId ?? null
}

function revisionActor(operations: readonly DesignOperation[]): RevisionActor {
  // 解锁只允许 actor=user，Revision 引擎会据此校验，因此 actor 必须如实反映来源。
  if (operations.some((operation) => operation.source === 'ai')) return 'ai'
  if (operations.every((operation) => operation.source === 'user')) return 'user'
  return 'system'
}

function toRevisionSummary(record: RevisionRecord): RevisionSummary {
  const revision = record.revision

  return {
    id: revision.id,
    seq: record.seq,
    kind: revision.kind,
    parentRevisionId: revision.parentRevisionId ?? null,
    ...(revision.targetRevisionId ? { targetRevisionId: revision.targetRevisionId } : {}),
    ...(revision.request ? { request: revision.request } : {}),
    operationCount: revision.operations.length,
    mutationCount: revision.mutations.length,
    actor: revision.provenance.actor,
    ...(revision.provenance.provider ? { provider: revision.provenance.provider } : {}),
    ...(revision.provenance.model ? { model: revision.provenance.model } : {}),
    stateVersionAfter: revision.stateVersionAfter,
    createdAt: revision.createdAt,
  }
}

function headConflict(headRevisionId: string | null) {
  return new ApiHttpError(409, 'REVISION_CONFLICT', '设计已被更新，请刷新后基于最新版本重试。', {
    headRevisionId,
  })
}

function projectNotFound() {
  return new ApiHttpError(404, 'PROJECT_NOT_FOUND', '项目不存在。')
}

function translateEngineError(error: unknown, headRevisionId: string | null): never {
  if (error instanceof LockedTargetError) {
    throw new ApiHttpError(422, 'TARGET_LOCKED', '目标已锁定，不能修改：' + error.targetId, {
      violations: [
        {
          code: 'revision.target_locked',
          severity: 'error',
          message: '目标已锁定，不能修改：' + error.targetId,
          objectIds: [error.targetId],
        },
      ],
    })
  }

  if (error instanceof UnlockNotPermittedError) {
    throw new ApiHttpError(
      422,
      'UNLOCK_NOT_PERMITTED',
      '只有用户本人可以解除锁定：' + error.targetId,
    )
  }

  if (error instanceof InvalidDesignMutationError) {
    throw new ApiHttpError(422, 'NO_EFFECTIVE_CHANGE', '这次修改无法应用到当前设计。')
  }

  if (error instanceof RevisionConflictError) {
    throw headConflict(headRevisionId)
  }

  throw error
}

export class ProjectService {
  private readonly store: DesignStore
  private readonly planner: SpatialPlanner
  private readonly migrations: JsonMigrationRegistry
  private readonly createId: IdGenerator
  private readonly now: () => string

  constructor(options: ProjectServiceOptions) {
    this.store = options.store
    this.planner = options.planner
    this.migrations = options.migrations ?? createDefaultJsonMigrations()
    this.createId = options.createId ?? uuidv7
    this.now = options.now ?? (() => new Date().toISOString())
  }

  /** 首次启动（库中没有任何项目）时创建示例项目。 */
  ensureSampleProject() {
    return this.store.transaction(() => {
      if (this.store.projects.list().length > 0) return undefined
      return this.insertProject(SAMPLE_PROJECT_NAME, sampleApartment)
    })
  }

  listProjects(): ProjectListResponse {
    return {
      projects: this.store.projects.list().map((project) => {
        const timeline = this.store.timelines.findBySpatialModel(project.currentSpatialModelId)
        const latest = timeline ? this.store.revisions.latest(timeline.id) : undefined

        return {
          id: project.id,
          name: project.name,
          createdAt: project.createdAt,
          updatedAt: project.updatedAt,
          currentSpatialModelId: project.currentSpatialModelId,
          headRevisionId: latest?.id ?? null,
        }
      }),
    }
  }

  createProject(request: CreateProjectRequest): ProjectDetail {
    const model = this.prepareSpatialModel(request.spatialModel ?? sampleApartment)
    const projectId = this.store.transaction(() =>
      this.insertProject(request.name ?? DEFAULT_PROJECT_NAME, model),
    )
    return this.getProject(projectId)
  }

  getProject(projectId: string): ProjectDetail {
    return this.toDetail(this.load(projectId))
  }

  uploadSpatialModel(projectId: string, input: HomeSpatialModel): ProjectDetail {
    const model = this.prepareSpatialModel(input)

    this.store.transaction(() => {
      const project = this.store.projects.get(projectId)
      if (!project) throw projectNotFound()

      const createdAt = this.now()
      const spatialModelId = this.insertSpatialModelWithTimeline(projectId, model, createdAt)
      this.store.projects.setCurrentSpatialModel(projectId, spatialModelId, createdAt)
    })

    return this.getProject(projectId)
  }

  async commitRevision(
    projectId: string,
    request: CommitRevisionRequest,
  ): Promise<CommitRevisionResponse> {
    const base = this.load(projectId)

    if (request.baseRevisionId !== headOf(base.timeline)) {
      throw headConflict(headOf(base.timeline))
    }

    // 服务端重写操作 ID（UUID v7），对象 ID 也由服务端生成，避免与已持久化对象重名而被覆盖。
    const operationIdMap: Record<string, string> = {}
    const operations = request.operations.map((operation) => {
      if (operationIdMap[operation.id]) {
        throw new ApiHttpError(
          400,
          'INVALID_REQUEST',
          '同一次提交中的操作 ID 不能重复：' + operation.id,
        )
      }
      const id = this.createId()
      operationIdMap[operation.id] = id
      return { ...operation, id }
    })

    const result = await this.planner.plan({
      spatialModel: base.spatialModel.model,
      state: base.timeline.state,
      operations,
      createObjectId: () => this.createId(),
    })
    const violations: Violation[] = result.violations.map((violation) => ({
      code: violation.code,
      severity: violation.severity,
      message: violation.message,
      ...(violation.operationId ? { operationId: violation.operationId } : {}),
      ...(violation.objectIds ? { objectIds: [...violation.objectIds] } : {}),
    }))

    if (violations.some((violation) => violation.severity === 'error')) {
      throw new ApiHttpError(422, 'CONSTRAINT_VIOLATION', '修改未通过空间约束校验，设计未改变。', {
        violations,
      })
    }

    if (result.mutations.length === 0) {
      throw new ApiHttpError(422, 'NO_EFFECTIVE_CHANGE', '这次请求没有产生任何设计变化。')
    }

    const committed = this.store.transaction(() => {
      // Planner 是异步的：落库前在写事务内重新读取并校验 head，防止并发提交覆盖。
      const current = this.load(projectId)

      if (
        current.timelineRecord.id !== base.timelineRecord.id ||
        headOf(current.timeline) !== request.baseRevisionId
      ) {
        throw headConflict(headOf(current.timeline))
      }

      const createdAt = this.now()
      let next: ReturnType<typeof commitToTimeline>

      try {
        next = commitToTimeline(current.timeline, {
          id: this.createId(),
          projectId,
          expectedParentRevisionId: request.baseRevisionId,
          ...(request.request ? { request: request.request } : {}),
          operations,
          mutations: result.mutations,
          provenance: {
            actor: revisionActor(operations),
            plannerVersion: PLANNER_VERSION,
            schemaVersion: DESIGN_STATE_SCHEMA_VERSION,
            ...(request.provenance?.provider ? { provider: request.provenance.provider } : {}),
            ...(request.provenance?.model ? { model: request.provenance.model } : {}),
          },
          createdAt,
        })
      } catch (error) {
        translateEngineError(error, headOf(current.timeline))
      }

      return this.appendRevision(current, next.revision, next.timeline.state, createdAt)
    })

    return {
      project: this.getProject(projectId),
      revision: toRevisionSummary(committed),
      operationIdMap,
      planner: {
        violations,
        decisions: result.decisions.map((decision) => ({ ...decision })),
      },
    }
  }

  undo(projectId: string, baseRevisionId: string | null): TimelineChangeResponse {
    return this.changeTimeline(projectId, baseRevisionId, 'undo')
  }

  redo(projectId: string, baseRevisionId: string | null): TimelineChangeResponse {
    return this.changeTimeline(projectId, baseRevisionId, 'redo')
  }

  /** 读取时间线的完整修订日志（审计 / 重放用）。 */
  readTimeline(projectId: string) {
    const loaded = this.load(projectId)
    return {
      initialState: loaded.timelineRecord.initialState,
      records: loaded.records,
      timeline: loaded.timeline,
    }
  }

  private changeTimeline(
    projectId: string,
    baseRevisionId: string | null,
    kind: 'undo' | 'redo',
  ): TimelineChangeResponse {
    const appended = this.store.transaction(() => {
      const current = this.load(projectId)
      const head = headOf(current.timeline)

      if (baseRevisionId !== head) throw headConflict(head)

      const createdAt = this.now()
      const options = { revisionId: this.createId(), actor: 'user' as const, createdAt }
      let change: ReturnType<typeof undoTimeline>

      try {
        change =
          kind === 'undo'
            ? undoTimeline(current.timeline, options)
            : redoTimeline(current.timeline, options)
      } catch (error) {
        translateEngineError(error, head)
      }

      if (!change.changed) {
        throw kind === 'undo'
          ? new ApiHttpError(409, 'NOTHING_TO_UNDO', '没有可撤销的修改。', { headRevisionId: head })
          : new ApiHttpError(409, 'NOTHING_TO_REDO', '没有可重做的修改。', { headRevisionId: head })
      }

      return this.appendRevision(current, change.revision, change.timeline.state, createdAt)
    })

    return {
      project: this.getProject(projectId),
      revision: toRevisionSummary(appended),
    }
  }

  private appendRevision(
    current: LoadedProject,
    revision: DesignRevision,
    stateAfter: DesignState,
    createdAt: string,
  ): RevisionRecord {
    const record: RevisionRecord = {
      id: revision.id,
      timelineId: current.timelineRecord.id,
      seq: current.records.length + 1,
      revision,
      stateAfter,
      createdAt,
    }

    this.store.revisions.append(record)
    this.store.projects.touch(current.project.id, createdAt)
    return record
  }

  /** 结构 / schemaVersion / 领域几何校验；不通过抛 422。 */
  private prepareSpatialModel(input: HomeSpatialModel): HomeSpatialModel {
    if (!this.migrations.canUpgrade('spatial-model', input.schemaVersion)) {
      throw new ApiHttpError(
        422,
        'UNSUPPORTED_SCHEMA_VERSION',
        '不支持的空间模型版本：' +
          input.schemaVersion +
          '（当前版本 ' +
          this.migrations.currentVersion('spatial-model') +
          '）。',
      )
    }

    const model = this.migrations.upgrade<HomeSpatialModel>(
      'spatial-model',
      input.schemaVersion,
      input,
    )
    let issues: Violation[]

    try {
      issues = validateHomeSpatialModel(model).issues.map((issue) => ({
        code: issue.code,
        severity: issue.severity,
        message: issue.message,
        path: issue.path,
        ...(issue.entityId ? { entityId: issue.entityId } : {}),
      }))
    } catch {
      throw new ApiHttpError(422, 'INVALID_SPATIAL_MODEL', '空间模型结构无效，无法完成校验。')
    }

    const errors = issues.filter((issue) => issue.severity === 'error')

    if (errors.length > 0) {
      throw new ApiHttpError(
        422,
        'INVALID_SPATIAL_MODEL',
        '空间模型未通过校验，共 ' + errors.length + ' 处错误。',
        {
          violations: errors,
        },
      )
    }

    return model
  }

  private insertProject(name: string, model: HomeSpatialModel) {
    const projectId = this.createId()
    const createdAt = this.now()
    const spatialModelId = this.createId()

    this.store.projects.insert({
      id: projectId,
      name,
      currentSpatialModelId: spatialModelId,
      createdAt,
      updatedAt: createdAt,
    })
    this.insertSpatialModelWithTimeline(projectId, model, createdAt, spatialModelId)
    return projectId
  }

  private insertSpatialModelWithTimeline(
    projectId: string,
    model: HomeSpatialModel,
    createdAt: string,
    spatialModelId = this.createId(),
  ) {
    this.store.spatialModels.insert({
      id: spatialModelId,
      projectId,
      schemaVersion: this.migrations.currentVersion('spatial-model'),
      model,
      createdAt,
    })
    this.store.timelines.insert({
      id: this.createId(),
      projectId,
      spatialModelId,
      initialState: createInitialDesignState({ projectId, spatialModelId }),
      createdAt,
    })
    return spatialModelId
  }

  private load(projectId: string): LoadedProject {
    const project = this.store.projects.get(projectId)
    if (!project) throw projectNotFound()

    const spatialModel = this.store.spatialModels.get(project.currentSpatialModelId)
    const timelineRecord = this.store.timelines.findBySpatialModel(project.currentSpatialModelId)

    if (!spatialModel || !timelineRecord) {
      throw new Error('项目数据不完整：' + projectId)
    }

    const records = this.store.revisions.listByTimeline(timelineRecord.id)
    const last = records[records.length - 1]
    const timeline = restoreRevisionTimeline(
      timelineRecord.initialState,
      records.map((record) => record.revision),
      last ? { headState: last.stateAfter } : {},
    )

    return { project, spatialModel, timelineRecord, records, timeline }
  }

  private toDetail(loaded: LoadedProject): ProjectDetail {
    const { project, spatialModel, timelineRecord, records, timeline } = loaded

    return {
      id: project.id,
      name: project.name,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
      spatialModel: {
        id: spatialModel.id,
        projectId: spatialModel.projectId,
        schemaVersion: spatialModel.schemaVersion,
        createdAt: spatialModel.createdAt,
        model: spatialModel.model,
      },
      timelineId: timelineRecord.id,
      state: timeline.state,
      headRevisionId: headOf(timeline),
      canUndo: timeline.past.length > 0,
      canRedo: timeline.future.length > 0,
      revisionCount: records.length,
      recentRevisions: records.slice(-RECENT_REVISION_LIMIT).reverse().map(toRevisionSummary),
    }
  }
}
