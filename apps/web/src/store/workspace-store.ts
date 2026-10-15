import type {
  DesignInterpretation,
  DesignInterpretationMeta,
  PlannerFeedback,
  ProjectDetail,
} from '@homescape/contracts'
import type { DesignObject, DesignOperation } from '@homescape/domain'
import {
  sampleApartment,
  validateHomeSpatialModel,
  type HomeSpatialModel,
} from '@homescape/spatial-model'
import { createStore, type StoreApi } from 'zustand/vanilla'
import { ApiClientError, createApiClient, describeApiError, type ApiClient } from '../api/client'
import {
  buildCompactSofaOperations,
  buildLayoutOperations,
  buildSofaLockOperations,
  createClientId,
  selectPrimaryDesignRoom,
} from './operations'
import { createProjectMemory, type ProjectMemory } from './project-memory'

export const CONFLICT_NOTICE = '数据已在其他地方更新，已刷新到最新状态'
export const STALE_PROPOSAL_MESSAGE = '工作区已发生变化，这次删除/替换提案已作废，请重新输入指令。'

export type WorkspaceStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface PendingDestructiveProposal {
  request: string
  operations: DesignOperation[]
  meta: DesignInterpretationMeta
  targets: { action: '删除' | '替换'; name: string }[]
  /** 提案生成时所见的工作区基线；确认时必须与当前一致。 */
  projectId: string
  spatialModelVersionId: string
  headRevisionId: string | null
}

export interface WorkspaceState {
  /** 启动加载状态；ready 之后 project 一定非空。 */
  status: WorkspaceStatus
  loadError: string | null
  /** 服务端返回的项目详情：空间模型版本、DesignState、head、canUndo / canRedo、近期修订。是唯一业务真值。 */
  project: ProjectDetail | null
  /** 提交 / 撤销 / 重做进行中。 */
  planning: boolean
  /** 自然语言解析进行中。 */
  interpreting: boolean
  /** 切换空间模型（上传）进行中。 */
  switching: boolean
  /** 提交 / 撤销 / 重做失败原因（含 422 违规原因）。 */
  revisionError: string | null
  /** 409 冲突后已刷新的提示。 */
  notice: string | null
  /** 最近一次提交的 Planner 反馈（警告与决策）；422 时只含违规。 */
  plannerFeedback: PlannerFeedback | null
  aiFeedback: DesignInterpretation | null
  aiError: string | null
  pendingProposal: PendingDestructiveProposal | null

  initialize(): Promise<void>
  refresh(): Promise<void>
  /** 提交操作列表；基线版本取当前 head。成功返回 true。 */
  commit(input: {
    request: string
    operations: DesignOperation[]
    meta?: DesignInterpretationMeta
  }): Promise<boolean>
  generateLayout(): Promise<boolean>
  replaceWithCompactSofa(): Promise<boolean>
  toggleSofaLock(): Promise<boolean>
  undo(): Promise<boolean>
  redo(): Promise<boolean>
  interpret(command: string): Promise<void>
  confirmPendingProposal(): Promise<void>
  dismissPendingProposal(): void
  /** 上传并切换到新的空间模型（新时间线）；失败时抛出带用户可读文案的 Error。 */
  switchSpatialModel(model: HomeSpatialModel): Promise<void>
  /** 切回示例空间：把示例户型作为新空间模型版本上传到当前项目（开启新时间线，旧时间线保留）；失败写入 revisionError。 */
  switchToSampleSpace(): Promise<void>
}

export interface WorkspaceStoreDeps {
  api: ApiClient
  memory: ProjectMemory
}

export type WorkspaceStore = StoreApi<WorkspaceState>

function isBusy(state: WorkspaceState) {
  return state.planning || state.interpreting || state.switching
}

function designObjects(project: ProjectDetail): DesignObject[] {
  return Object.values(project.state.objects)
}

/** 项目切换或空间模型切换时，丢弃与旧工作区绑定的反馈。 */
const CLEARED_FEEDBACK = {
  revisionError: null,
  notice: null,
  plannerFeedback: null,
  aiFeedback: null,
  aiError: null,
  pendingProposal: null,
} as const

function sameBaseline(
  baseline: { projectId: string; spatialModelVersionId: string; headRevisionId: string | null },
  project: ProjectDetail | null,
) {
  return (
    project !== null &&
    project.id === baseline.projectId &&
    project.spatialModel.id === baseline.spatialModelVersionId &&
    project.headRevisionId === baseline.headRevisionId
  )
}

function mostRecentlyUpdated<T extends { updatedAt: string }>(items: readonly T[]): T | undefined {
  return items.reduce<T | undefined>(
    (latest, item) => (!latest || item.updatedAt > latest.updatedAt ? item : latest),
    undefined,
  )
}

export function createWorkspaceStore(deps: WorkspaceStoreDeps): WorkspaceStore {
  const { api, memory } = deps
  let initPromise: Promise<void> | null = null

  return createStore<WorkspaceState>()((set, get) => {
    /** 以服务端返回的项目详情为准；工作区（项目 / 空间模型版本）变化时清空旧反馈。 */
    function adopt(project: ProjectDetail, extra: Partial<WorkspaceState> = {}) {
      const previous = get().project
      const workspaceChanged =
        !previous || previous.id !== project.id || previous.spatialModel.id !== project.spatialModel.id

      memory.write(project.id)
      set({
        project,
        status: 'ready',
        loadError: null,
        ...(workspaceChanged ? CLEARED_FEEDBACK : {}),
        ...extra,
      })
    }

    /** 提交 / 撤销 / 重做失败后的统一处理。 */
    async function handleMutationError(error: unknown, projectId: string) {
      if (!(error instanceof ApiClientError)) {
        set({ revisionError: describeApiError(error) })
        return
      }

      if (error.isRevisionConflict) {
        await refreshAfterConflict(projectId)
        return
      }

      if (error.status === 409) {
        // NOTHING_TO_UNDO / NOTHING_TO_REDO：本地按钮状态已过期，刷新并说明原因。
        set({ revisionError: describeApiError(error), pendingProposal: null })
        await refreshQuietly(projectId)
        return
      }

      set({
        revisionError: describeApiError(error),
        ...(error.violations.length > 0
          ? { plannerFeedback: { violations: error.violations, decisions: [] } }
          : {}),
      })
    }

    async function refreshQuietly(projectId: string) {
      try {
        const project = await api.getProject(projectId)
        if (get().project?.id === projectId) adopt(project)
      } catch {
        // 刷新失败不覆盖已有错误提示；下一次操作仍会由服务端 409 兜底。
      }
    }

    async function refreshAfterConflict(projectId: string) {
      try {
        const project = await api.getProject(projectId)
        adopt(project, { notice: CONFLICT_NOTICE, revisionError: null, pendingProposal: null })
      } catch (error) {
        set({
          revisionError: '数据已在其他地方更新，但刷新失败：' + describeApiError(error),
          pendingProposal: null,
        })
      }
    }

    async function runTimelineChange(kind: 'undo' | 'redo') {
      const { project, planning, switching } = get()
      if (!project || planning || switching) return false

      set({ planning: true })

      try {
        const result = await api[kind](project.id, project.headRevisionId)
        adopt(result.project, { revisionError: null, notice: null })
        return true
      } catch (error) {
        await handleMutationError(error, project.id)
        return false
      } finally {
        set({ planning: false })
      }
    }

    async function runDeterministic(
      build: (project: ProjectDetail) => { request: string; operations: DesignOperation[] } | null,
    ) {
      const project = get().project
      if (!project) return false

      const built = build(project)
      if (!built) return false

      return get().commit(built)
    }

    return {
      status: 'idle',
      loadError: null,
      project: null,
      planning: false,
      interpreting: false,
      switching: false,
      ...CLEARED_FEEDBACK,

      initialize() {
        if (initPromise) return initPromise

        initPromise = (async () => {
          set({ status: 'loading', loadError: null })

          try {
            const { projects } = await api.listProjects()
            const remembered = memory.read()
            const target =
              projects.find((project) => project.id === remembered) ?? mostRecentlyUpdated(projects)
            // 没有任何项目时（例如数据库被清空）创建示例项目，而不是停在空白页。
            const project = target ? await api.getProject(target.id) : await api.createProject({})

            adopt(project)
          } catch (error) {
            initPromise = null
            set({ status: 'error', loadError: describeApiError(error) })
          }
        })()

        return initPromise
      },

      async refresh() {
        const project = get().project
        if (!project) return

        try {
          adopt(await api.getProject(project.id))
        } catch (error) {
          set({ revisionError: describeApiError(error) })
        }
      },

      async commit({ request, operations, meta }) {
        const { project, planning, switching } = get()
        if (!project || planning || switching) return false

        set({ planning: true })

        try {
          const result = await api.commitRevision(project.id, {
            baseRevisionId: project.headRevisionId,
            operations,
            request: request.trim().slice(0, 500),
            ...(meta ? { provenance: { provider: meta.provider, model: meta.model } } : {}),
          })

          adopt(result.project, {
            plannerFeedback: result.planner,
            revisionError: null,
            notice: null,
          })
          return true
        } catch (error) {
          await handleMutationError(error, project.id)
          return false
        } finally {
          set({ planning: false })
        }
      },

      generateLayout: () =>
        runDeterministic((project) => {
          const room = selectPrimaryDesignRoom(project.spatialModel.model)
          return room ? buildLayoutOperations(room) : null
        }),

      replaceWithCompactSofa: () =>
        runDeterministic((project) => {
          const objects = designObjects(project)
          const sofa = objects.find((object) => object.category === 'sofa')
          return sofa ? buildCompactSofaOperations(sofa, objects) : null
        }),

      toggleSofaLock: () =>
        runDeterministic((project) => {
          const sofa = designObjects(project).find((object) => object.category === 'sofa')
          return sofa ? buildSofaLockOperations(sofa, Boolean(project.state.locks[sofa.id])) : null
        }),

      undo: () => runTimelineChange('undo'),
      redo: () => runTimelineChange('redo'),

      async interpret(command) {
        const state = get()
        const project = state.project
        const normalized = command.trim()

        if (!project || !normalized || isBusy(state)) return

        const room = selectPrimaryDesignRoom(project.spatialModel.model)
        if (!room) return

        const baseline = {
          projectId: project.id,
          spatialModelVersionId: project.spatialModel.id,
          headRevisionId: project.headRevisionId,
        }
        const objects = designObjects(project)

        set({ interpreting: true, aiError: null, pendingProposal: null })

        try {
          const interpretation = await api.interpret({
            requestId: createClientId('design-command'),
            command: normalized,
            context: {
              projectId: project.id,
              activeRoom: { id: room.id, name: room.name },
              objects: objects.map((object) => {
                const catalogName = object.metadata?.catalogName
                const currentColor = object.metadata?.colorFamily

                return {
                  id: object.id,
                  category: object.category,
                  label: typeof catalogName === 'string' ? catalogName : object.category,
                  locked: Boolean(project.state.locks[object.id]),
                  ...(object.roomId ? { roomId: object.roomId } : {}),
                  ...(object.zoneId ? { zoneId: object.zoneId } : {}),
                  ...(object.dimensions ? { width: object.dimensions[0] } : {}),
                  ...(typeof currentColor === 'string' ? { colorFamily: currentColor } : {}),
                }
              }),
            },
          })

          set({ aiFeedback: interpretation })

          if (interpretation.status !== 'ready' || interpretation.operations.length === 0) return

          // 解析期间工作区被改动（其他标签页提交 / 切换户型）时，不再基于新状态静默执行旧提案。
          if (!sameBaseline(baseline, get().project)) {
            set({ aiError: STALE_PROPOSAL_MESSAGE })
            return
          }

          const targets = interpretation.operations.flatMap((operation) => {
            if (operation.type !== 'remove_object' && operation.type !== 'replace_object') return []

            const target = objects.find((item) => item.id === operation.objectId)
            const catalogName = target?.metadata?.catalogName
            const name =
              typeof catalogName === 'string'
                ? catalogName
                : (target?.category ?? '未知对象（' + operation.objectId + '）')

            return [{ action: operation.type === 'remove_object' ? '删除' : '替换', name } as const]
          })

          if (targets.length > 0) {
            set({
              pendingProposal: {
                request: normalized,
                operations: interpretation.operations,
                meta: interpretation.meta,
                targets,
                ...baseline,
              },
            })
            return
          }

          await get().commit({
            request: normalized,
            operations: interpretation.operations,
            meta: interpretation.meta,
          })
        } catch (error) {
          set({ aiError: describeApiError(error) })
        } finally {
          set({ interpreting: false })
        }
      },

      async confirmPendingProposal() {
        const state = get()
        const proposal = state.pendingProposal
        if (!proposal || isBusy(state)) return

        set({ pendingProposal: null })

        if (!sameBaseline(proposal, state.project)) {
          set({ aiError: STALE_PROPOSAL_MESSAGE })
          return
        }

        set({ aiError: null })
        await get().commit({
          request: proposal.request,
          operations: proposal.operations,
          meta: proposal.meta,
        })
      },

      dismissPendingProposal() {
        set({ pendingProposal: null })
      },

      async switchSpatialModel(model) {
        const state = get()
        const project = state.project

        if (!project) throw new Error('项目尚未加载完成，请稍后再试。')
        if (isBusy(state)) throw new Error('设计任务执行期间不能切换空间模型')

        if (!validateHomeSpatialModel(model).valid) {
          throw new Error('不能切换到未通过 HomeSpatialModel Validation 的空间模型')
        }

        if (!selectPrimaryDesignRoom(model)) throw new Error('Finalize 的空间模型没有可设计房间')

        set({ switching: true })

        try {
          adopt(await api.uploadSpatialModel(project.id, { spatialModel: model }))
        } catch (error) {
          throw new Error(describeApiError(error), { cause: error })
        } finally {
          set({ switching: false })
        }
      },

      async switchToSampleSpace() {
        try {
          await get().switchSpatialModel(sampleApartment)
        } catch (error) {
          set({ revisionError: error instanceof Error ? error.message : String(error) })
        }
      },
    }
  })
}

// ---------- 应用使用的默认实例 ----------

let defaultStore: WorkspaceStore | undefined

export function getWorkspaceStore(): WorkspaceStore {
  defaultStore ??= createWorkspaceStore({ api: createApiClient(), memory: createProjectMemory() })
  return defaultStore
}
