import type { DesignOperation } from '@homescape/domain'
import { sampleApartment } from '@homescape/spatial-model'
import { describe, expect, it, vi, type Mocked } from 'vitest'
import { ApiClientError, type ApiClient } from '../api/client'
import { createProjectMemory, LAST_PROJECT_STORAGE_KEY } from './project-memory'
import {
  makeCommitResponse,
  makeInterpretation,
  makeProject,
  SOFA,
} from './test-fixtures'
import {
  CONFLICT_NOTICE,
  createWorkspaceStore,
  STALE_PROPOSAL_MESSAGE,
} from './workspace-store'

function fakeApi(overrides: Partial<ApiClient> = {}): Mocked<ApiClient> {
  const api = {
    listProjects: vi.fn(async () => ({ projects: [] })),
    getProject: vi.fn(async () => makeProject()),
    createProject: vi.fn(async () => makeProject()),
    uploadSpatialModel: vi.fn(async () => makeProject()),
    commitRevision: vi.fn(async () => makeCommitResponse(makeProject({ head: 'rev-1' }))),
    undo: vi.fn(),
    redo: vi.fn(),
    interpret: vi.fn(),
    ...overrides,
  }
  // 覆盖项在测试中均以 vi.fn 传入，运行时即 Mock。
  return api as unknown as Mocked<ApiClient>
}

function memoryStub(initial: string | null = null) {
  let value = initial
  return {
    read: vi.fn(() => value),
    write: vi.fn((id: string) => {
      value = id
    }),
  }
}

async function readyStore(
  project = makeProject(),
  apiOverrides: Partial<ApiClient> = {},
) {
  const api = fakeApi({
    listProjects: vi.fn(async () => ({
      projects: [
        {
          id: project.id,
          name: project.name,
          createdAt: project.createdAt,
          updatedAt: project.updatedAt,
          currentSpatialModelId: project.spatialModel.id,
          headRevisionId: project.headRevisionId,
        },
      ],
    })),
    getProject: vi.fn(async () => project),
    ...apiOverrides,
  })
  const memory = memoryStub()
  const store = createWorkspaceStore({ api, memory })
  await store.getState().initialize()
  return { api, memory, store }
}

function http(status: number, code: string, message: string, extra: object = {}) {
  return new ApiClientError('http', message, { status, code, ...extra })
}

const removeSofa = (id = 'op-1'): DesignOperation => ({
  id,
  type: 'remove_object',
  source: 'ai',
  scope: { type: 'object', objectId: SOFA.id },
  objectId: SOFA.id,
})

describe('workspace store · 启动', () => {
  it('打开记住的项目并记录 ID', async () => {
    const other = makeProject({ id: 'project-2', updatedAt: '2026-10-16T00:00:00.000Z' })
    const remembered = makeProject({ id: 'project-1' })
    const api = fakeApi({
      listProjects: vi.fn(async () => ({
        projects: [remembered, other].map((p) => ({
          id: p.id,
          name: p.name,
          createdAt: p.createdAt,
          updatedAt: p.updatedAt,
          currentSpatialModelId: p.spatialModel.id,
          headRevisionId: null,
        })),
      })),
      getProject: vi.fn(async (id: string) => (id === 'project-1' ? remembered : other)),
    })
    const memory = memoryStub('project-1')
    const store = createWorkspaceStore({ api, memory })

    await store.getState().initialize()

    expect(api.getProject).toHaveBeenCalledWith('project-1')
    expect(store.getState().status).toBe('ready')
    expect(store.getState().project?.id).toBe('project-1')
    expect(memory.write).toHaveBeenCalledWith('project-1')
  })

  it('记住的项目不存在时回退到最近更新的项目', async () => {
    const older = makeProject({ id: 'a', updatedAt: '2026-10-01T00:00:00.000Z' })
    const newer = makeProject({ id: 'b', updatedAt: '2026-10-10T00:00:00.000Z' })
    const api = fakeApi({
      listProjects: vi.fn(async () => ({
        projects: [older, newer].map((p) => ({
          id: p.id,
          name: p.name,
          createdAt: p.createdAt,
          updatedAt: p.updatedAt,
          currentSpatialModelId: p.spatialModel.id,
          headRevisionId: null,
        })),
      })),
      getProject: vi.fn(async (id: string) => (id === 'a' ? older : newer)),
    })
    const store = createWorkspaceStore({ api, memory: memoryStub('gone') })

    await store.getState().initialize()

    expect(api.getProject).toHaveBeenCalledWith('b')
  })

  it('没有任何项目时创建示例项目', async () => {
    const api = fakeApi()
    const store = createWorkspaceStore({ api, memory: memoryStub() })

    await store.getState().initialize()

    expect(api.createProject).toHaveBeenCalledWith({})
    expect(store.getState().status).toBe('ready')
  })

  it('并发调用 initialize 只加载一次；失败后可重试', async () => {
    const listProjects = vi
      .fn()
      .mockRejectedValueOnce(new ApiClientError('network', '无法连接到设计服务，请检查网络后重试。'))
      .mockResolvedValue({ projects: [] })
    const api = fakeApi({ listProjects })
    const store = createWorkspaceStore({ api, memory: memoryStub() })

    await Promise.all([store.getState().initialize(), store.getState().initialize()])
    expect(listProjects).toHaveBeenCalledTimes(1)
    expect(store.getState().status).toBe('error')
    expect(store.getState().loadError).toContain('无法连接')

    await store.getState().initialize()
    expect(store.getState().status).toBe('ready')
  })

  it('localStorage 读写抛错时不影响启动', () => {
    const memory = createProjectMemory(() => ({
      getItem: () => {
        throw new Error('denied')
      },
      setItem: () => {
        throw new Error('denied')
      },
    }))

    expect(memory.read()).toBeNull()
    expect(() => memory.write('p')).not.toThrow()
  })

  it('localStorage 正常时读写同一个键', () => {
    const data = new Map<string, string>()
    const memory = createProjectMemory(() => ({
      getItem: (key) => data.get(key) ?? null,
      setItem: (key, value) => void data.set(key, value),
    }))

    memory.write('project-9')

    expect(data.get(LAST_PROJECT_STORAGE_KEY)).toBe('project-9')
    expect(memory.read()).toBe('project-9')
  })
})

describe('workspace store · 提交修订', () => {
  it('提交 baseRevisionId 与操作，并用返回的项目详情更新 store', async () => {
    const next = makeProject({ head: 'rev-1', objects: [SOFA] })
    const { api, store } = await readyStore(makeProject({ head: 'rev-0' }), {
      commitRevision: vi.fn(async () => ({
        ...makeCommitResponse(next),
        planner: {
          violations: [{ code: 'W', severity: 'warning' as const, message: '提示' }],
          decisions: [],
        },
      })),
    })

    const ok = await store.getState().generateLayout()

    expect(ok).toBe(true)
    const [projectId, request] = api.commitRevision.mock.calls[0]!
    expect(projectId).toBe('project-1')
    expect(request.baseRevisionId).toBe('rev-0')
    expect(request.operations.map((operation) => operation.type)).toEqual([
      'add_object',
      'add_object',
      'add_object',
    ])
    expect(request.request).toContain('生成现代原木风基础软装布局')
    expect(store.getState().project?.headRevisionId).toBe('rev-1')
    expect(store.getState().plannerFeedback?.violations).toHaveLength(1)
    expect(store.getState().planning).toBe(false)
  })

  it('操作 ID 由随机 ID 生成，不依赖会在刷新后重置的计数器', async () => {
    const { api, store } = await readyStore()

    await store.getState().generateLayout()
    await store.getState().generateLayout()

    const ids = api.commitRevision.mock.calls.flatMap(([, request]) =>
      request.operations.map((operation) => operation.id),
    )
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.every((id) => id.length <= 100)).toBe(true)
  })

  it('提交进行中不会重复提交', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const { api, store } = await readyStore(makeProject(), {
      commitRevision: vi.fn(async () => {
        await gate
        return makeCommitResponse(makeProject({ head: 'rev-1' }))
      }),
    })

    const first = store.getState().generateLayout()
    const second = await store.getState().generateLayout()
    release()
    await first

    expect(second).toBe(false)
    expect(api.commitRevision).toHaveBeenCalledTimes(1)
  })

  it('409 冲突：重新拉取项目、提示已刷新并作废待确认提案', async () => {
    const stale = makeProject({ head: 'rev-1', objects: [SOFA] })
    const latest = makeProject({ head: 'rev-2', objects: [] })
    let reads = 0
    const { store, api } = await readyStore(stale, {
      getProject: vi.fn(async () => (reads++ === 0 ? stale : latest)),
      commitRevision: vi.fn(async () => {
        throw http(409, 'REVISION_CONFLICT', '版本已变化', { headRevisionId: 'rev-2' })
      }),
    })
    store.setState({
      pendingProposal: {
        request: 'x',
        operations: [],
        meta: makeInterpretation().meta,
        targets: [],
        projectId: 'project-1',
        spatialModelVersionId: 'smv-1',
        headRevisionId: 'rev-1',
      },
    })

    const ok = await store.getState().commit({ request: '改', operations: [removeSofa()] })

    expect(ok).toBe(false)
    expect(api.getProject).toHaveBeenCalledTimes(2)
    expect(store.getState().project?.headRevisionId).toBe('rev-2')
    expect(store.getState().notice).toBe(CONFLICT_NOTICE)
    expect(store.getState().pendingProposal).toBeNull()
    expect(store.getState().revisionError).toBeNull()
  })

  it('422：展示违规原因并记录约束问题，项目保持不变', async () => {
    const project = makeProject({ head: 'rev-1' })
    const { store } = await readyStore(project, {
      commitRevision: vi.fn(async () => {
        throw http(422, 'CONSTRAINT_VIOLATION', '修改未通过空间约束校验，设计未改变。', {
          violations: [{ code: 'COLLISION', severity: 'error', message: '沙发与墙体重叠' }],
        })
      }),
    })

    await store.getState().commit({ request: '改', operations: [removeSofa()] })

    expect(store.getState().revisionError).toContain('沙发与墙体重叠')
    expect(store.getState().plannerFeedback?.violations[0]?.code).toBe('COLLISION')
    expect(store.getState().project).toBe(project)
    expect(store.getState().notice).toBeNull()
  })

  it('网络错误只提示，不改变项目', async () => {
    const project = makeProject()
    const { store } = await readyStore(project, {
      commitRevision: vi.fn(async () => {
        throw new ApiClientError('network', '无法连接到设计服务，请检查网络后重试。')
      }),
    })

    await store.getState().generateLayout()

    expect(store.getState().revisionError).toContain('无法连接')
    expect(store.getState().project).toBe(project)
    expect(store.getState().planning).toBe(false)
  })

  it('AI 来源的提交带上 provider / model', async () => {
    const { api, store } = await readyStore()
    const meta = makeInterpretation().meta

    await store.getState().commit({ request: '改', operations: [removeSofa()], meta })

    expect(api.commitRevision.mock.calls[0]![1].provenance).toEqual({
      provider: 'test-provider',
      model: 'test-model',
    })
  })
})

describe('workspace store · Undo / Redo', () => {
  it('调用服务端接口并以返回结果为准', async () => {
    const before = makeProject({ head: 'rev-2', objects: [SOFA], canUndo: true })
    const after = makeProject({ head: 'rev-3', objects: [], canUndo: true, canRedo: true })
    const { store, api } = await readyStore(before, {
      undo: vi.fn(async () => ({ project: after, revision: makeCommitResponse(after).revision })),
      redo: vi.fn(async () => ({ project: before, revision: makeCommitResponse(before).revision })),
    })

    expect(await store.getState().undo()).toBe(true)
    expect(api.undo).toHaveBeenCalledWith('project-1', 'rev-2')
    expect(store.getState().project?.canRedo).toBe(true)

    expect(await store.getState().redo()).toBe(true)
    expect(api.redo).toHaveBeenCalledWith('project-1', 'rev-3')
  })

  it('冲突时刷新到最新状态；NOTHING_TO_UNDO 显示原因并刷新', async () => {
    const stale = makeProject({ head: 'rev-1' })
    const latest = makeProject({ head: 'rev-5' })
    let reads = 0
    const undo = vi
      .fn()
      .mockRejectedValueOnce(http(409, 'REVISION_CONFLICT', '版本已变化'))
      .mockRejectedValueOnce(http(409, 'NOTHING_TO_UNDO', '没有可撤销的修订'))
    const { store } = await readyStore(stale, {
      getProject: vi.fn(async () => (reads++ === 0 ? stale : latest)),
      undo,
    })

    await store.getState().undo()
    expect(store.getState().notice).toBe(CONFLICT_NOTICE)
    expect(store.getState().project?.headRevisionId).toBe('rev-5')

    await store.getState().undo()
    expect(store.getState().revisionError).toBe('没有可撤销的修订')
    expect(store.getState().notice).toBe(CONFLICT_NOTICE)
  })
})

describe('workspace store · 自然语言与待确认提案', () => {
  const withSofa = () => makeProject({ head: 'rev-1', objects: [SOFA] })

  it('删除 / 替换先进入待确认，确认后才提交', async () => {
    const { store, api } = await readyStore(withSofa(), {
      interpret: vi.fn(async () => makeInterpretation({ operations: [removeSofa()] })),
    })

    await store.getState().interpret('把沙发删掉')

    expect(api.commitRevision).not.toHaveBeenCalled()
    expect(store.getState().pendingProposal?.targets).toEqual([{ action: '删除', name: '三人沙发' }])
    expect(store.getState().interpreting).toBe(false)

    await store.getState().confirmPendingProposal()

    expect(api.commitRevision).toHaveBeenCalledTimes(1)
    expect(api.commitRevision.mock.calls[0]![1].baseRevisionId).toBe('rev-1')
    expect(store.getState().pendingProposal).toBeNull()
  })

  it('取消待确认提案不会提交', async () => {
    const { store, api } = await readyStore(withSofa(), {
      interpret: vi.fn(async () => makeInterpretation({ operations: [removeSofa()] })),
    })

    await store.getState().interpret('把沙发删掉')
    store.getState().dismissPendingProposal()
    await store.getState().confirmPendingProposal()

    expect(api.commitRevision).not.toHaveBeenCalled()
  })

  it('工作区基线变化后提案作废，不会静默执行', async () => {
    const { store, api } = await readyStore(withSofa(), {
      interpret: vi.fn(async () => makeInterpretation({ operations: [removeSofa()] })),
    })

    await store.getState().interpret('把沙发删掉')
    store.setState({ project: makeProject({ head: 'rev-2', objects: [SOFA] }) })
    await store.getState().confirmPendingProposal()

    expect(api.commitRevision).not.toHaveBeenCalled()
    expect(store.getState().aiError).toBe(STALE_PROPOSAL_MESSAGE)
    expect(store.getState().pendingProposal).toBeNull()
  })

  it('不含删除 / 替换的提案直接提交，requestId 为随机 ID 且上下文带锁定状态', async () => {
    const lock: DesignOperation = {
      id: 'op-lock',
      type: 'lock',
      source: 'ai',
      scope: { type: 'object', objectId: SOFA.id },
      targetId: SOFA.id,
    }
    const { store, api } = await readyStore(withSofa(), {
      interpret: vi.fn(async () => makeInterpretation({ operations: [lock] })),
    })

    await store.getState().interpret('  锁定沙发  ')

    const request = api.interpret.mock.calls[0]![0]
    expect(request.command).toBe('锁定沙发')
    expect(request.requestId.length).toBeGreaterThan(8)
    expect(request.context.activeRoom.name).toBeTruthy()
    expect(request.context.objects[0]).toMatchObject({ id: SOFA.id, label: '三人沙发', locked: false })
    expect(api.commitRevision.mock.calls[0]![1].provenance?.provider).toBe('test-provider')
  })

  it('AI 未配置（503）等错误显示在 AI 区域，不触发提交', async () => {
    const { store, api } = await readyStore(withSofa(), {
      interpret: vi.fn(async () => {
        throw http(503, 'AI_NOT_CONFIGURED', '自然语言设计服务暂未启用，请联系管理员。')
      }),
    })

    await store.getState().interpret('锁定沙发')

    expect(store.getState().aiError).toContain('暂未启用')
    expect(store.getState().interpreting).toBe(false)
    expect(api.commitRevision).not.toHaveBeenCalled()
  })

  it('needs_clarification 只展示反馈，不执行', async () => {
    const { store, api } = await readyStore(withSofa(), {
      interpret: vi.fn(async () =>
        makeInterpretation({ status: 'needs_clarification', operations: [removeSofa()] }),
      ),
    })

    await store.getState().interpret('那个')

    expect(store.getState().aiFeedback?.status).toBe('needs_clarification')
    expect(store.getState().pendingProposal).toBeNull()
    expect(api.commitRevision).not.toHaveBeenCalled()
  })
})

describe('workspace store · 切换空间模型', () => {
  it('上传成功后切换到新时间线并清空旧反馈', async () => {
    const imported = { ...sampleApartment, id: 'imported-1', name: '导入户型' }
    const next = makeProject({ spatialModelVersionId: 'smv-2' })
    const { store, api } = await readyStore(makeProject({ head: 'rev-1' }), {
      uploadSpatialModel: vi.fn(async () => ({
        ...next,
        spatialModel: { ...next.spatialModel, model: imported },
      })),
    })
    store.setState({ aiFeedback: makeInterpretation(), notice: 'x', revisionError: 'y' })

    await store.getState().switchSpatialModel(imported)

    expect(api.uploadSpatialModel).toHaveBeenCalledWith('project-1', { spatialModel: imported })
    expect(store.getState().project?.spatialModel.id).toBe('smv-2')
    expect(store.getState().project?.headRevisionId).toBeNull()
    expect(store.getState().aiFeedback).toBeNull()
    expect(store.getState().notice).toBeNull()
    expect(store.getState().revisionError).toBeNull()
    expect(store.getState().switching).toBe(false)
  })

  it('服务端 422 时抛出带违规原因的错误，保留当前项目', async () => {
    const project = makeProject()
    const { store } = await readyStore(project, {
      uploadSpatialModel: vi.fn(async () => {
        throw http(422, 'INVALID_SPATIAL_MODEL', '空间模型未通过校验。', {
          violations: [{ code: 'WALL', severity: 'error', message: '墙体未闭合' }],
        })
      }),
    })

    await expect(store.getState().switchSpatialModel(sampleApartment)).rejects.toThrow('墙体未闭合')
    expect(store.getState().project).toBe(project)
    expect(store.getState().switching).toBe(false)
  })

  it('未通过本地校验的空间模型不会上传', async () => {
    const { store, api } = await readyStore()
    const broken = { ...sampleApartment, floors: [] }

    await expect(store.getState().switchSpatialModel(broken)).rejects.toThrow()
    expect(api.uploadSpatialModel).not.toHaveBeenCalled()
  })

  it('进行中的设计任务期间拒绝切换', async () => {
    const { store, api } = await readyStore()
    store.setState({ planning: true })

    await expect(store.getState().switchSpatialModel(sampleApartment)).rejects.toThrow('不能切换')
    expect(api.uploadSpatialModel).not.toHaveBeenCalled()
  })

  it('切回示例空间：上传示例户型；失败写入 revisionError 而不抛出', async () => {
    const { store, api } = await readyStore(makeProject(), {
      uploadSpatialModel: vi.fn(async () => {
        throw new ApiClientError('network', '无法连接到设计服务，请检查网络后重试。')
      }),
    })

    await store.getState().switchToSampleSpace()

    expect(api.uploadSpatialModel.mock.calls[0]![1].spatialModel.id).toBe(sampleApartment.id)
    expect(store.getState().revisionError).toContain('无法连接')
  })
})
