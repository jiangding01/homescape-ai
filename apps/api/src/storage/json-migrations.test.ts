import { describe, expect, it } from 'vitest'
import {
  createDefaultJsonMigrations,
  JsonMigrationRegistry,
  UnsupportedSchemaVersionError,
} from './json-migrations'

describe('JSON 迁移注册表', () => {
  it('当前版本原样返回，未知版本拒绝而不是静默解释', () => {
    const registry = createDefaultJsonMigrations()
    const current = registry.currentVersion('design-state')
    const value = { schemaVersion: current }

    expect(registry.upgrade('design-state', current, value)).toBe(value)
    expect(registry.canUpgrade('design-state', '9.9.9')).toBe(false)
    expect(() => registry.upgrade('design-state', '9.9.9', value)).toThrow(
      UnsupportedSchemaVersionError,
    )
  })

  it('按 from → to 链式升级到当前版本，循环链视为不可升级', () => {
    const registry = new JsonMigrationRegistry(
      { 'spatial-model': '3', 'design-state': '1', 'design-revision': '1' },
      {
        'spatial-model': [
          { from: '1', to: '2', migrate: (value) => ({ ...(value as object), step1: true }) },
          { from: '2', to: '3', migrate: (value) => ({ ...(value as object), step2: true }) },
        ],
        'design-state': [
          { from: 'a', to: 'b', migrate: (value) => value },
          { from: 'b', to: 'a', migrate: (value) => value },
        ],
      },
    )

    expect(registry.upgrade('spatial-model', '1', { id: 'm' })).toEqual({
      id: 'm',
      step1: true,
      step2: true,
    })
    expect(registry.canUpgrade('design-state', 'a')).toBe(false)
  })
})
