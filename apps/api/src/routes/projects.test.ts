import {
  ApiErrorResponseSchema,
  CommitRevisionResponseSchema,
  ProjectDetailSchema,
  ProjectListResponseSchema,
  TimelineChangeResponseSchema,
  type ProjectDetail,
} from '@homescape/contracts'
import { replayRevisions, type DesignOperation } from '@homescape/domain'
import { sampleApartment, type HomeSpatialModel } from '@homescape/spatial-model'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { UUID_V7_PATTERN } from '../ids'
import { buildServer } from '../server'
import { openSqliteDesignStore } from '../storage/sqlite-store'
import type { DesignStore } from '../storage/types'

type TestServer = ReturnType<typeof buildServer>

const servers: TestServer[] = []
const stores: DesignStore[] = []
const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()))
  stores.splice(0).forEach((store) => store.close())
  tempDirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true }))
})

function createServer(options: Parameters<typeof buildServer>[0] = {}) {
  const server = buildServer({ logger: false, interpreter: undefined, ...options })
  servers.push(server)
  return server
}

function createStore(path = ':memory:') {
  const store = openSqliteDesignStore(path)
  stores.push(store)
  return store
}

const ROOM = { type: 'room', roomId: 'room-living' } as const

function addSofa(id = 'op-sofa'): DesignOperation {
  return {
    id,
    type: 'add_object',
    source: 'user',
    scope: ROOM,
    category: 'sofa',
    requirements: { style: 'warm-modern', minSeats: 3, maxWidth: 2.3 },
  }
}

function addPlant(id = 'op-plant'): DesignOperation {
  return {
    id,
    type: 'add_object',
    source: 'user',
    scope: ROOM,
    category: 'plant',
    requirements: { styleTags: ['warm-modern', 'greenery'] },
  }
}

async function createProject(server: TestServer, payload: object = { name: '测试项目' }) {
  const response = await server.inject({ method: 'POST', url: '/api/v1/projects', payload })
  expect(response.statusCode).toBe(201)
  return ProjectDetailSchema.parse(response.json())
}

async function getProject(server: TestServer, id: string) {
  const response = await server.inject({ method: 'GET', url: '/api/v1/projects/' + id })
  expect(response.statusCode).toBe(200)
  return ProjectDetailSchema.parse(response.json())
}

function commit(
  server: TestServer,
  projectId: string,
  baseRevisionId: string | null,
  operations: DesignOperation[],
  extra: object = {},
) {
  return server.inject({
    method: 'POST',
    url: '/api/v1/projects/' + projectId + '/revisions',
    payload: { baseRevisionId, operations, ...extra },
  })
}

async function commitOk(
  server: TestServer,
  projectId: string,
  baseRevisionId: string | null,
  operations: DesignOperation[],
  extra: object = {},
) {
  const response = await commit(server, projectId, baseRevisionId, operations, extra)
  expect(response.statusCode, response.body).toBe(201)
  return CommitRevisionResponseSchema.parse(response.json())
}

function timelineChange(
  server: TestServer,
  projectId: string,
  kind: 'undo' | 'redo',
  baseRevisionId: string | null,
) {
  return server.inject({
    method: 'POST',
    url: '/api/v1/projects/' + projectId + '/' + kind,
    payload: { baseRevisionId },
  })
}

function errorOf(response: { json(): unknown }) {
  return ApiErrorResponseSchema.parse(response.json()).error
}

function objectIds(project: ProjectDetail) {
  return Object.keys(project.state.objects).sort()
}

describe('/api/v1 项目', () => {
  it('首次启动自动创建示例项目，重复启动不重复创建', async () => {
    const store = createStore()
    const first = createServer({ store })
    const list = ProjectListResponseSchema.parse(
      (await first.inject({ method: 'GET', url: '/api/v1/projects' })).json(),
    )

    expect(list.projects).toHaveLength(1)
    expect(list.projects[0]?.name).toBe('示例项目')
    expect(list.projects[0]?.headRevisionId).toBeNull()

    const second = createServer({ store })
    const again = ProjectListResponseSchema.parse(
      (await second.inject({ method: 'GET', url: '/api/v1/projects' })).json(),
    )
    expect(again.projects.map((project) => project.id)).toEqual(
      list.projects.map((project) => project.id),
    )

    const sample = await getProject(first, list.projects[0]?.id ?? '')
    expect(sample.spatialModel.model.id).toBe(sampleApartment.id)
  })

  it('创建项目缺省使用示例户型，新时间线为空', async () => {
    const server = createServer()
    const project = await createProject(server)

    expect(project.id).toMatch(UUID_V7_PATTERN)
    expect(project.name).toBe('测试项目')
    expect(project.spatialModel.model.id).toBe(sampleApartment.id)
    expect(project.spatialModel.id).toMatch(UUID_V7_PATTERN)
    expect(project.state.spatialModelId).toBe(project.spatialModel.id)
    expect(project.state.projectId).toBe(project.id)
    expect(project.headRevisionId).toBeNull()
    expect(project.canUndo).toBe(false)
    expect(project.canRedo).toBe(false)
    expect(project.recentRevisions).toEqual([])
  })

  it('不存在的项目返回 404', async () => {
    const server = createServer()
    const response = await server.inject({ method: 'GET', url: '/api/v1/projects/missing' })

    expect(response.statusCode).toBe(404)
    expect(errorOf(response).code).toBe('PROJECT_NOT_FOUND')
  })

  it('请求体不符合契约返回 400 与中文说明', async () => {
    const server = createServer()
    const project = await createProject(server)
    const response = await commit(server, project.id, null, [], { unexpected: true })

    expect(response.statusCode).toBe(400)
    const error = errorOf(response)
    expect(error.code).toBe('INVALID_REQUEST')
    expect(error.message).toBe('请求格式无效。')
    expect(error.issues?.length).toBeGreaterThan(0)
  })
})

describe('/api/v1 修订提交', () => {
  it('提交布局后读取一致，服务端生成修订、操作与对象 ID', async () => {
    const server = createServer()
    const project = await createProject(server)
    const result = await commitOk(server, project.id, null, [addSofa(), addPlant()], {
      request: '生成客厅基础布局',
      provenance: { provider: 'test-provider', model: 'test-model' },
    })

    expect(result.revision.id).toMatch(UUID_V7_PATTERN)
    expect(result.revision.kind).toBe('commit')
    expect(result.revision.seq).toBe(1)
    expect(result.revision.request).toBe('生成客厅基础布局')
    expect(result.revision.actor).toBe('user')
    expect(result.revision.provider).toBe('test-provider')
    expect(result.revision.model).toBe('test-model')
    expect(Object.keys(result.operationIdMap)).toEqual(['op-sofa', 'op-plant'])
    Object.values(result.operationIdMap).forEach((id) => expect(id).toMatch(UUID_V7_PATTERN))

    const detail = result.project
    expect(detail.headRevisionId).toBe(result.revision.id)
    expect(detail.canUndo).toBe(true)
    expect(detail.canRedo).toBe(false)
    expect(detail.state.version).toBe(1)
    expect(objectIds(detail)).toHaveLength(2)
    objectIds(detail).forEach((id) => expect(id).toMatch(UUID_V7_PATTERN))

    const reread = await getProject(server, project.id)
    expect(reread).toEqual(detail)
  })

  it('同一请求重复提交两次“添加沙发”，得到两个不同对象，旧对象不被覆盖', async () => {
    const server = createServer()
    const project = await createProject(server)
    const first = await commitOk(server, project.id, null, [addSofa('same-op')])
    const [firstSofaId] = objectIds(first.project)
    const firstSofa = first.project.state.objects[firstSofaId ?? '']

    const second = await commitOk(server, project.id, first.revision.id, [addSofa('same-op')])

    expect(second.operationIdMap['same-op']).not.toBe(first.operationIdMap['same-op'])
    expect(objectIds(second.project)).toHaveLength(2)
    expect(second.project.state.objects[firstSofaId ?? '']).toEqual(firstSofa)
    expect(
      Object.values(second.project.state.objects).every((object) => object.category === 'sofa'),
    ).toBe(true)
  })

  it('baseRevisionId 与当前 head 不一致返回 409 并附当前 head', async () => {
    const server = createServer()
    const project = await createProject(server)
    const first = await commitOk(server, project.id, null, [addPlant()])

    const stale = await commit(server, project.id, null, [addSofa()])
    expect(stale.statusCode).toBe(409)
    expect(errorOf(stale)).toMatchObject({
      code: 'REVISION_CONFLICT',
      headRevisionId: first.revision.id,
    })

    const unknown = await commit(server, project.id, 'not-a-revision', [addSofa()])
    expect(unknown.statusCode).toBe(409)

    const after = await getProject(server, project.id)
    expect(after.headRevisionId).toBe(first.revision.id)
    expect(after.revisionCount).toBe(1)
  })

  it('并发提交基于同一 head 时只有一个成功，另一个 409', async () => {
    const server = createServer()
    const project = await createProject(server)
    const responses = await Promise.all([
      commit(server, project.id, null, [addPlant('a')]),
      commit(server, project.id, null, [addSofa('b')]),
    ])

    expect(responses.map((response) => response.statusCode).sort()).toEqual([201, 409])
    const after = await getProject(server, project.id)
    expect(after.revisionCount).toBe(1)
    expect(objectIds(after)).toHaveLength(1)
  })

  it('约束不通过返回 422 与违规原因，状态不变', async () => {
    const server = createServer()
    const project = await createProject(server)
    const response = await commit(server, project.id, null, [
      {
        id: 'op-missing',
        type: 'move_object',
        source: 'user',
        scope: ROOM,
        objectId: 'object-missing',
        position: [1, 0, 1],
      },
    ])

    expect(response.statusCode).toBe(422)
    const error = errorOf(response)
    expect(error.code).toBe('CONSTRAINT_VIOLATION')
    expect(error.violations?.[0]?.code).toBe('planner.object_missing')

    const after = await getProject(server, project.id)
    expect(after.headRevisionId).toBeNull()
    expect(after.revisionCount).toBe(0)
  })

  it('锁定对象后提交修改返回 422，解锁须为用户来源', async () => {
    const server = createServer()
    const project = await createProject(server)
    const added = await commitOk(server, project.id, null, [addPlant()])
    const [plantId = ''] = objectIds(added.project)
    const locked = await commitOk(server, project.id, added.revision.id, [
      { id: 'lock', type: 'lock', source: 'user', scope: ROOM, targetId: plantId },
    ])

    const moved = await commit(server, project.id, locked.revision.id, [
      {
        id: 'move',
        type: 'move_object',
        source: 'user',
        scope: ROOM,
        objectId: plantId,
        position: [1, 0, 1],
      },
    ])
    expect(moved.statusCode).toBe(422)

    const aiUnlock = await commit(server, project.id, locked.revision.id, [
      { id: 'unlock', type: 'unlock', source: 'ai', scope: ROOM, targetId: plantId },
    ])
    expect(aiUnlock.statusCode).toBe(422)

    const after = await getProject(server, project.id)
    expect(after.headRevisionId).toBe(locked.revision.id)
    expect(after.state.locks[plantId]).toBeDefined()
  })
})

describe('/api/v1 撤销与重做', () => {
  it('撤销 / 重做为补偿修订，读取一致', async () => {
    const server = createServer()
    const project = await createProject(server)
    const first = await commitOk(server, project.id, null, [addSofa()])
    const second = await commitOk(server, project.id, first.revision.id, [addPlant()])

    const undoResponse = await timelineChange(server, project.id, 'undo', second.revision.id)
    expect(undoResponse.statusCode).toBe(200)
    const undone = TimelineChangeResponseSchema.parse(undoResponse.json())
    expect(undone.revision.kind).toBe('undo')
    expect(undone.revision.targetRevisionId).toBe(second.revision.id)
    expect(undone.project.state.objects).toEqual(first.project.state.objects)
    expect(undone.project.canUndo).toBe(true)
    expect(undone.project.canRedo).toBe(true)
    expect(await getProject(server, project.id)).toEqual(undone.project)

    const redoResponse = await timelineChange(server, project.id, 'redo', undone.revision.id)
    expect(redoResponse.statusCode).toBe(200)
    const redone = TimelineChangeResponseSchema.parse(redoResponse.json())
    expect(redone.revision.kind).toBe('redo')
    expect(redone.project.state.objects).toEqual(second.project.state.objects)
    expect(redone.project.canRedo).toBe(false)
    expect(redone.project.revisionCount).toBe(4)
    expect(redone.project.recentRevisions.map((revision) => revision.kind)).toEqual([
      'redo',
      'undo',
      'commit',
      'commit',
    ])
    expect(await getProject(server, project.id)).toEqual(redone.project)
  })

  it('无可撤销 / 重做返回 409，基线过期也返回 409', async () => {
    const server = createServer()
    const project = await createProject(server)

    const nothingToUndo = await timelineChange(server, project.id, 'undo', null)
    expect(nothingToUndo.statusCode).toBe(409)
    expect(errorOf(nothingToUndo)).toMatchObject({ code: 'NOTHING_TO_UNDO', headRevisionId: null })

    const first = await commitOk(server, project.id, null, [addPlant()])
    const nothingToRedo = await timelineChange(server, project.id, 'redo', first.revision.id)
    expect(nothingToRedo.statusCode).toBe(409)
    expect(errorOf(nothingToRedo).code).toBe('NOTHING_TO_REDO')

    const stale = await timelineChange(server, project.id, 'undo', null)
    expect(stale.statusCode).toBe(409)
    expect(errorOf(stale)).toMatchObject({
      code: 'REVISION_CONFLICT',
      headRevisionId: first.revision.id,
    })
  })

  it('撤销后新提交清空重做栈', async () => {
    const server = createServer()
    const project = await createProject(server)
    const first = await commitOk(server, project.id, null, [addPlant()])
    const undone = TimelineChangeResponseSchema.parse(
      (await timelineChange(server, project.id, 'undo', first.revision.id)).json(),
    )
    const next = await commitOk(server, project.id, undone.revision.id, [addSofa()])

    expect(next.project.canRedo).toBe(false)
    expect(next.project.canUndo).toBe(true)
  })
})

describe('/api/v1 空间模型', () => {
  it('上传合法空间模型后切换为当前模型并开启新时间线，旧时间线保留', async () => {
    const store = createStore()
    const server = createServer({ store })
    const project = await createProject(server)
    const committed = await commitOk(server, project.id, null, [addPlant()])

    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/projects/' + project.id + '/spatial-models',
      payload: { spatialModel: sampleApartment },
    })
    expect(response.statusCode).toBe(201)
    const switched = ProjectDetailSchema.parse(response.json())

    expect(switched.spatialModel.id).not.toBe(project.spatialModel.id)
    expect(switched.timelineId).not.toBe(project.timelineId)
    expect(switched.headRevisionId).toBeNull()
    expect(switched.state.objects).toEqual({})
    expect(switched.state.spatialModelId).toBe(switched.spatialModel.id)

    expect(store.revisions.listByTimeline(project.timelineId).map((record) => record.id)).toEqual([
      committed.revision.id,
    ])
  })

  it('非法空间模型返回 422 与校验问题，当前模型不变', async () => {
    const server = createServer()
    const project = await createProject(server)
    const broken = structuredClone(sampleApartment) as HomeSpatialModel
    const room = broken.floors[0]?.rooms[0]
    if (room) {
      room.boundary = {
        points: [
          [0, 0],
          [1, 0],
          [2, 0],
        ],
      }
    }

    const invalid = await server.inject({
      method: 'POST',
      url: '/api/v1/projects/' + project.id + '/spatial-models',
      payload: { spatialModel: broken },
    })
    expect(invalid.statusCode).toBe(422)
    const error = errorOf(invalid)
    expect(error.code).toBe('INVALID_SPATIAL_MODEL')
    expect(error.violations?.length).toBeGreaterThan(0)
    expect(error.violations?.every((violation) => violation.severity === 'error')).toBe(true)

    const wrongVersion = await server.inject({
      method: 'POST',
      url: '/api/v1/projects/' + project.id + '/spatial-models',
      payload: { spatialModel: { ...sampleApartment, schemaVersion: '0.1.0' } },
    })
    expect(wrongVersion.statusCode).toBe(422)
    expect(errorOf(wrongVersion).code).toBe('UNSUPPORTED_SCHEMA_VERSION')

    const malformed = await server.inject({
      method: 'POST',
      url: '/api/v1/projects/' + project.id + '/spatial-models',
      payload: { spatialModel: { id: 'x' } },
    })
    expect(malformed.statusCode).toBe(400)

    const createWithBroken = await server.inject({
      method: 'POST',
      url: '/api/v1/projects',
      payload: { name: '坏户型', spatialModel: broken },
    })
    expect(createWithBroken.statusCode).toBe(422)

    expect((await getProject(server, project.id)).spatialModel.id).toBe(project.spatialModel.id)
  })
})

describe('/api/v1 持久化', () => {
  it('重启服务（同一数据库文件）后状态完整恢复', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'homescape-api-'))
    tempDirs.push(dir)
    const databasePath = join(dir, 'homescape.sqlite')

    const before = createServer({ databasePath })
    const project = await createProject(before)
    const first = await commitOk(before, project.id, null, [addSofa()])
    const second = await commitOk(before, project.id, first.revision.id, [addPlant()])
    const undone = TimelineChangeResponseSchema.parse(
      (await timelineChange(before, project.id, 'undo', second.revision.id)).json(),
    )
    const snapshot = await getProject(before, project.id)
    expect(snapshot).toEqual(undone.project)
    await before.close()

    const after = createServer({ databasePath })
    const restored = await getProject(after, project.id)
    expect(restored).toEqual(snapshot)
    expect(restored.canRedo).toBe(true)

    const list = ProjectListResponseSchema.parse(
      (await after.inject({ method: 'GET', url: '/api/v1/projects' })).json(),
    )
    expect(list.projects).toHaveLength(2)

    // 重启后继续重做，链条连续。
    const redone = await timelineChange(after, project.id, 'redo', restored.headRevisionId)
    expect(redone.statusCode).toBe(200)
    expect(TimelineChangeResponseSchema.parse(redone.json()).project.state.objects).toEqual(
      second.project.state.objects,
    )
  })

  it('修订日志重放结果与每条快照一致', async () => {
    const store = createStore()
    const server = createServer({ store })
    const project = await createProject(server)
    const first = await commitOk(server, project.id, null, [addSofa()])
    const second = await commitOk(server, project.id, first.revision.id, [addPlant()])
    const undone = TimelineChangeResponseSchema.parse(
      (await timelineChange(server, project.id, 'undo', second.revision.id)).json(),
    )
    await timelineChange(server, project.id, 'redo', undone.revision.id)

    const timeline = store.timelines.findBySpatialModel(project.spatialModel.id)
    expect(timeline).toBeDefined()
    const records = store.revisions.listByTimeline(timeline?.id ?? '')
    expect(records.map((record) => record.seq)).toEqual([1, 2, 3, 4])

    records.forEach((record, index) => {
      const replayed = replayRevisions(
        timeline!.initialState,
        records.slice(0, index + 1).map((item) => item.revision),
      )
      expect(replayed).toEqual(record.stateAfter)
    })

    const detail = await getProject(server, project.id)
    expect(records.at(-1)?.stateAfter).toEqual(detail.state)
  })

  it('修订记录只追加，数据库拒绝修改与删除', () => {
    const store = createStore()
    createServer({ store })
    const db = (store as unknown as { db: { exec(sql: string): void } }).db

    db.exec(
      "INSERT INTO revisions VALUES ('r', (SELECT id FROM timelines LIMIT 1), 1, 'commit', NULL, '{}', '1', '{}', '0.1.0', 'now')",
    )
    expect(() => db.exec("UPDATE revisions SET kind = 'undo'")).toThrow(/只追加/)
    expect(() => db.exec('DELETE FROM revisions')).toThrow(/只追加/)
    expect(() => db.exec('DELETE FROM spatial_models')).toThrow(/不可删除/)
  })
})
