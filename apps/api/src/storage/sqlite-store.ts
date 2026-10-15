import type { DesignRevision, DesignState } from '@homescape/domain'
import type { HomeSpatialModel } from '@homescape/spatial-model'
import { DatabaseSync, type StatementSync } from 'node:sqlite'
import {
  createDefaultJsonMigrations,
  DESIGN_REVISION_RECORD_VERSION,
  type JsonMigrationRegistry,
} from './json-migrations'
import type {
  DesignStore,
  ProjectRecord,
  ProjectRepository,
  RevisionRecord,
  RevisionRepository,
  SpatialModelRecord,
  SpatialModelRepository,
  TimelineRecord,
  TimelineRepository,
} from './types'

export interface SqlMigration {
  version: number
  name: string
  sql: string
}

/** 数据库结构迁移；只追加，不修改已发布的条目。 */
export const SQL_MIGRATIONS: readonly SqlMigration[] = [
  {
    version: 1,
    name: 'initial_design_state',
    sql: `
      CREATE TABLE projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        current_spatial_model_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE spatial_models (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id),
        model_id TEXT NOT NULL,
        schema_version TEXT NOT NULL,
        model_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX spatial_models_by_project ON spatial_models(project_id, created_at);

      CREATE TABLE timelines (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id),
        spatial_model_id TEXT NOT NULL UNIQUE REFERENCES spatial_models(id),
        initial_state_json TEXT NOT NULL,
        state_schema_version TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE revisions (
        id TEXT PRIMARY KEY,
        timeline_id TEXT NOT NULL REFERENCES timelines(id),
        seq INTEGER NOT NULL CHECK (seq >= 1),
        kind TEXT NOT NULL CHECK (kind IN ('commit', 'undo', 'redo')),
        parent_revision_id TEXT,
        revision_json TEXT NOT NULL,
        revision_schema_version TEXT NOT NULL,
        state_after_json TEXT NOT NULL,
        state_schema_version TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE (timeline_id, seq)
      );

      CREATE TRIGGER spatial_models_immutable_update BEFORE UPDATE ON spatial_models
      BEGIN SELECT RAISE(ABORT, 'spatial_models 不可修改'); END;
      CREATE TRIGGER spatial_models_immutable_delete BEFORE DELETE ON spatial_models
      BEGIN SELECT RAISE(ABORT, 'spatial_models 不可删除'); END;
      CREATE TRIGGER revisions_append_only_update BEFORE UPDATE ON revisions
      BEGIN SELECT RAISE(ABORT, 'revisions 只追加，不可修改'); END;
      CREATE TRIGGER revisions_append_only_delete BEFORE DELETE ON revisions
      BEGIN SELECT RAISE(ABORT, 'revisions 只追加，不可删除'); END;
    `,
  },
]

export const IN_MEMORY_DATABASE = ':memory:'

type Row = Record<string, unknown>

function text(row: Row, column: string) {
  const value = row[column]
  if (typeof value !== 'string') {
    throw new Error('数据库列类型异常：' + column)
  }
  return value
}

function integer(row: Row, column: string) {
  const value = row[column]
  if (typeof value === 'bigint') return Number(value)
  if (typeof value !== 'number') {
    throw new Error('数据库列类型异常：' + column)
  }
  return value
}

export function runSqlMigrations(
  db: DatabaseSync,
  migrations: readonly SqlMigration[] = SQL_MIGRATIONS,
) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    )
  `)

  const applied = new Set(
    (db.prepare('SELECT version FROM schema_migrations').all() as Row[]).map((row) =>
      integer(row, 'version'),
    ),
  )
  const latestKnown = Math.max(0, ...migrations.map((migration) => migration.version))
  const latestApplied = Math.max(0, ...applied)

  if (latestApplied > latestKnown) {
    throw new Error(
      '数据库结构版本 ' +
        latestApplied +
        ' 高于当前程序支持的版本 ' +
        latestKnown +
        '，请升级服务。',
    )
  }

  const insert = db.prepare(
    'INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)',
  )

  for (const migration of [...migrations].sort((a, b) => a.version - b.version)) {
    if (applied.has(migration.version)) continue

    db.exec('BEGIN IMMEDIATE')
    try {
      db.exec(migration.sql)
      insert.run(migration.version, migration.name, new Date().toISOString())
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }
}

export interface SqliteDesignStoreOptions {
  migrations?: JsonMigrationRegistry
}

export class SqliteDesignStore implements DesignStore {
  readonly projects: ProjectRepository
  readonly spatialModels: SpatialModelRepository
  readonly timelines: TimelineRepository
  readonly revisions: RevisionRepository

  private readonly db: DatabaseSync
  private readonly jsonMigrations: JsonMigrationRegistry
  private inTransaction = false

  constructor(path: string, options: SqliteDesignStoreOptions = {}) {
    this.db = new DatabaseSync(path)
    this.jsonMigrations = options.migrations ?? createDefaultJsonMigrations()
    this.db.exec('PRAGMA foreign_keys = ON')
    this.db.exec('PRAGMA busy_timeout = 5000')

    if (path !== IN_MEMORY_DATABASE) {
      this.db.exec('PRAGMA journal_mode = WAL')
    }

    runSqlMigrations(this.db)

    this.projects = this.createProjectRepository()
    this.spatialModels = this.createSpatialModelRepository()
    this.timelines = this.createTimelineRepository()
    this.revisions = this.createRevisionRepository()
  }

  transaction<T>(fn: () => T): T {
    if (this.inTransaction) {
      throw new Error('不支持嵌套事务')
    }

    // IMMEDIATE：事务开始即取得写锁，多进程并发写时也能保证“校验 head → 写入”原子。
    this.db.exec('BEGIN IMMEDIATE')
    this.inTransaction = true

    try {
      const result = fn()

      if (result instanceof Promise) {
        throw new Error('事务回调不能是异步函数')
      }

      this.db.exec('COMMIT')
      return result
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    } finally {
      this.inTransaction = false
    }
  }

  close() {
    if (this.db.isOpen) {
      this.db.close()
    }
  }

  private upgrade<T>(
    kind: 'spatial-model' | 'design-state' | 'design-revision',
    version: string,
    json: string,
  ): T {
    return this.jsonMigrations.upgrade<T>(kind, version, JSON.parse(json))
  }

  private createProjectRepository(): ProjectRepository {
    const list = this.db.prepare('SELECT * FROM projects ORDER BY created_at, id')
    const get = this.db.prepare('SELECT * FROM projects WHERE id = ?')
    const insert = this.db.prepare(
      'INSERT INTO projects (id, name, current_spatial_model_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    )
    const setCurrent = this.db.prepare(
      'UPDATE projects SET current_spatial_model_id = ?, updated_at = ? WHERE id = ?',
    )
    const touch = this.db.prepare('UPDATE projects SET updated_at = ? WHERE id = ?')
    const toRecord = (row: Row): ProjectRecord => ({
      id: text(row, 'id'),
      name: text(row, 'name'),
      currentSpatialModelId: text(row, 'current_spatial_model_id'),
      createdAt: text(row, 'created_at'),
      updatedAt: text(row, 'updated_at'),
    })

    return {
      list: () => (list.all() as Row[]).map(toRecord),
      get: (id) => {
        const row = get.get(id) as Row | undefined
        return row ? toRecord(row) : undefined
      },
      insert: (record) => {
        insert.run(
          record.id,
          record.name,
          record.currentSpatialModelId,
          record.createdAt,
          record.updatedAt,
        )
      },
      setCurrentSpatialModel: (projectId, spatialModelId, updatedAt) => {
        expectOneChange(setCurrent, [spatialModelId, updatedAt, projectId], projectId)
      },
      touch: (projectId, updatedAt) => {
        expectOneChange(touch, [updatedAt, projectId], projectId)
      },
    }
  }

  private createSpatialModelRepository(): SpatialModelRepository {
    const get = this.db.prepare('SELECT * FROM spatial_models WHERE id = ?')
    const insert = this.db.prepare(
      'INSERT INTO spatial_models (id, project_id, model_id, schema_version, model_json, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    )

    return {
      get: (id) => {
        const row = get.get(id) as Row | undefined
        if (!row) return undefined
        const schemaVersion = text(row, 'schema_version')

        return {
          id: text(row, 'id'),
          projectId: text(row, 'project_id'),
          schemaVersion: this.jsonMigrations.currentVersion('spatial-model'),
          model: this.upgrade<HomeSpatialModel>(
            'spatial-model',
            schemaVersion,
            text(row, 'model_json'),
          ),
          createdAt: text(row, 'created_at'),
        } satisfies SpatialModelRecord
      },
      insert: (record) => {
        insert.run(
          record.id,
          record.projectId,
          record.model.id,
          record.schemaVersion,
          JSON.stringify(record.model),
          record.createdAt,
        )
      },
    }
  }

  private createTimelineRepository(): TimelineRepository {
    const find = this.db.prepare('SELECT * FROM timelines WHERE spatial_model_id = ?')
    const insert = this.db.prepare(
      'INSERT INTO timelines (id, project_id, spatial_model_id, initial_state_json, state_schema_version, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    )

    return {
      findBySpatialModel: (spatialModelId) => {
        const row = find.get(spatialModelId) as Row | undefined
        if (!row) return undefined

        return {
          id: text(row, 'id'),
          projectId: text(row, 'project_id'),
          spatialModelId: text(row, 'spatial_model_id'),
          initialState: this.upgrade<DesignState>(
            'design-state',
            text(row, 'state_schema_version'),
            text(row, 'initial_state_json'),
          ),
          createdAt: text(row, 'created_at'),
        }
      },
      insert: (record) => {
        insert.run(
          record.id,
          record.projectId,
          record.spatialModelId,
          JSON.stringify(record.initialState),
          record.initialState.schemaVersion,
          record.createdAt,
        )
      },
    }
  }

  private createRevisionRepository(): RevisionRepository {
    const list = this.db.prepare('SELECT * FROM revisions WHERE timeline_id = ? ORDER BY seq')
    const latest = this.db.prepare(
      'SELECT * FROM revisions WHERE timeline_id = ? ORDER BY seq DESC LIMIT 1',
    )
    const insert = this.db.prepare(
      `INSERT INTO revisions (
        id, timeline_id, seq, kind, parent_revision_id, revision_json, revision_schema_version,
        state_after_json, state_schema_version, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    const toRecord = (row: Row): RevisionRecord => ({
      id: text(row, 'id'),
      timelineId: text(row, 'timeline_id'),
      seq: integer(row, 'seq'),
      revision: this.upgrade<DesignRevision>(
        'design-revision',
        text(row, 'revision_schema_version'),
        text(row, 'revision_json'),
      ),
      stateAfter: this.upgrade<DesignState>(
        'design-state',
        text(row, 'state_schema_version'),
        text(row, 'state_after_json'),
      ),
      createdAt: text(row, 'created_at'),
    })

    return {
      listByTimeline: (timelineId) => (list.all(timelineId) as Row[]).map(toRecord),
      latest: (timelineId) => {
        const row = latest.get(timelineId) as Row | undefined
        return row ? toRecord(row) : undefined
      },
      append: (record) => {
        insert.run(
          record.id,
          record.timelineId,
          record.seq,
          record.revision.kind,
          record.revision.parentRevisionId ?? null,
          JSON.stringify(record.revision),
          DESIGN_REVISION_RECORD_VERSION,
          JSON.stringify(record.stateAfter),
          record.stateAfter.schemaVersion,
          record.createdAt,
        )
      },
    }
  }
}

function expectOneChange(statement: StatementSync, params: string[], id: string) {
  const result = statement.run(...params)

  if (Number(result.changes) !== 1) {
    throw new Error('记录不存在：' + id)
  }
}

export function openSqliteDesignStore(path: string, options: SqliteDesignStoreOptions = {}) {
  return new SqliteDesignStore(path, options)
}
