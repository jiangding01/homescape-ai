import { DESIGN_STATE_SCHEMA_VERSION } from '@homescape/domain'
import { HOME_SPATIAL_MODEL_SCHEMA_VERSION } from '@homescape/spatial-model'

/** 持久化 JSON 文档的种类；每种文档各自带 schemaVersion。 */
export type JsonDocumentKind = 'spatial-model' | 'design-state' | 'design-revision'

/**
 * DesignRevision 本身没有 schemaVersion 字段，这里是服务端存储格式的版本号。
 * 修改 DesignRevision / ResolvedDesignMutation 的结构时须递增并注册迁移。
 */
export const DESIGN_REVISION_RECORD_VERSION = '1'

export interface JsonMigrationStep {
  from: string
  to: string
  migrate(value: unknown): unknown
}

export class UnsupportedSchemaVersionError extends Error {
  readonly kind: JsonDocumentKind
  readonly version: string

  constructor(kind: JsonDocumentKind, version: string, currentVersion: string) {
    super(
      '不支持的 ' +
        kind +
        ' schemaVersion：' +
        version +
        '（当前版本 ' +
        currentVersion +
        '，且没有可用的迁移）',
    )
    this.name = 'UnsupportedSchemaVersionError'
    this.kind = kind
    this.version = version
  }
}

/**
 * 读取持久化 JSON 时按 from → to 链式升级到当前版本。
 * 目前没有任何迁移步骤：只接受当前版本，其余版本一律报错而不是静默按新结构解释。
 */
export class JsonMigrationRegistry {
  constructor(
    private readonly currentVersions: Readonly<Record<JsonDocumentKind, string>>,
    private readonly steps: Readonly<
      Partial<Record<JsonDocumentKind, readonly JsonMigrationStep[]>>
    > = {},
  ) {}

  currentVersion(kind: JsonDocumentKind) {
    return this.currentVersions[kind]
  }

  canUpgrade(kind: JsonDocumentKind, version: string) {
    return this.findPath(kind, version) !== undefined
  }

  upgrade<T>(kind: JsonDocumentKind, version: string, value: unknown): T {
    const path = this.findPath(kind, version)

    if (!path) {
      throw new UnsupportedSchemaVersionError(kind, version, this.currentVersion(kind))
    }

    return path.reduce((current, step) => step.migrate(current), value) as T
  }

  private findPath(kind: JsonDocumentKind, version: string) {
    const target = this.currentVersion(kind)
    const steps = this.steps[kind] ?? []
    const path: JsonMigrationStep[] = []
    const visited = new Set<string>()
    let current = version

    while (current !== target) {
      if (visited.has(current)) return undefined
      visited.add(current)

      const step = steps.find((candidate) => candidate.from === current)
      if (!step) return undefined

      path.push(step)
      current = step.to
    }

    return path
  }
}

export function createDefaultJsonMigrations() {
  return new JsonMigrationRegistry({
    'spatial-model': HOME_SPATIAL_MODEL_SCHEMA_VERSION,
    'design-state': DESIGN_STATE_SCHEMA_VERSION,
    'design-revision': DESIGN_REVISION_RECORD_VERSION,
  })
}
