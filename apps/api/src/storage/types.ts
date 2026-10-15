import type { DesignRevision, DesignState } from '@homescape/domain'
import type { HomeSpatialModel } from '@homescape/spatial-model'

export interface ProjectRecord {
  id: string
  name: string
  currentSpatialModelId: string
  createdAt: string
  updatedAt: string
}

/** 不可变的空间模型版本。 */
export interface SpatialModelRecord {
  id: string
  projectId: string
  schemaVersion: string
  model: HomeSpatialModel
  createdAt: string
}

/** 项目 × 空间模型版本的一条修订时间线。 */
export interface TimelineRecord {
  id: string
  projectId: string
  spatialModelId: string
  initialState: DesignState
  createdAt: string
}

/** 只追加的修订记录，附修订后的完整状态快照。 */
export interface RevisionRecord {
  id: string
  timelineId: string
  /** 时间线内序号，从 1 开始连续递增。 */
  seq: number
  revision: DesignRevision
  stateAfter: DesignState
  createdAt: string
}

export interface ProjectRepository {
  list(): ProjectRecord[]
  get(id: string): ProjectRecord | undefined
  insert(record: ProjectRecord): void
  setCurrentSpatialModel(projectId: string, spatialModelId: string, updatedAt: string): void
  touch(projectId: string, updatedAt: string): void
}

export interface SpatialModelRepository {
  get(id: string): SpatialModelRecord | undefined
  insert(record: SpatialModelRecord): void
}

export interface TimelineRepository {
  findBySpatialModel(spatialModelId: string): TimelineRecord | undefined
  insert(record: TimelineRecord): void
}

export interface RevisionRepository {
  /** 按 seq 升序返回时间线的完整修订日志。 */
  listByTimeline(timelineId: string): RevisionRecord[]
  latest(timelineId: string): RevisionRecord | undefined
  append(record: RevisionRecord): void
}

/**
 * 设计状态存储。仓储方法为同步接口（node:sqlite 为同步 API）；
 * transaction 内不得 await，保证“校验 head → 写入”原子完成。
 */
export interface DesignStore {
  readonly projects: ProjectRepository
  readonly spatialModels: SpatialModelRepository
  readonly timelines: TimelineRepository
  readonly revisions: RevisionRepository
  transaction<T>(fn: () => T): T
  close(): void
}
