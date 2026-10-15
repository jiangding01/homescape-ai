import { InMemoryCatalog, livingRoomCatalog } from '@homescape/catalog'
import { createInitialDesignState, type DesignOperation } from '@homescape/domain'
import { sampleApartment } from '@homescape/spatial-model'
import { describe, expect, it } from 'vitest'
import { RuleBasedPlanner } from './rule-based-planner'

const addSofa: DesignOperation = {
  id: 'op-sofa',
  type: 'add_object',
  source: 'user',
  scope: { type: 'room', roomId: 'room-living' },
  category: 'sofa',
  requirements: { maxWidth: 2.3 },
}

function plan(createObjectId?: (operation: DesignOperation) => string) {
  const planner = new RuleBasedPlanner(new InMemoryCatalog(livingRoomCatalog))

  return planner.plan({
    spatialModel: sampleApartment,
    state: createInitialDesignState({
      projectId: 'project-test',
      spatialModelId: sampleApartment.id,
    }),
    operations: [addSofa],
    ...(createObjectId ? { createObjectId } : {}),
  })
}

function upsertedIds(result: Awaited<ReturnType<typeof plan>>) {
  return result.mutations.flatMap((mutation) =>
    mutation.type === 'upsert_object' ? [mutation.object.id] : [],
  )
}

describe('Planner 对象 ID 生成', () => {
  it('缺省沿用 object-<operationId>，保持前端本地流程兼容', async () => {
    const result = await plan()

    expect(upsertedIds(result)).toEqual(['object-op-sofa'])
  })

  it('可注入对象 ID 生成器', async () => {
    const seen: string[] = []
    const result = await plan((operation) => {
      seen.push(operation.id)
      return 'injected-' + operation.id
    })

    expect(seen).toEqual(['op-sofa'])
    expect(upsertedIds(result)).toEqual(['injected-op-sofa'])
  })
})
