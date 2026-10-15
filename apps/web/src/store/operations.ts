import type { DesignObject, DesignOperation } from '@homescape/domain'
import {
  polygonArea,
  type HomeSpatialModel,
  type Room,
} from '@homescape/spatial-model'

/**
 * 客户端操作 ID 只用于对应请求与响应，服务端提交时会重写为 UUID v7。
 * crypto.randomUUID 只在安全上下文（https / localhost）可用，局域网 http 访问时退化为 getRandomValues。
 */
export function createClientId(prefix: string): string {
  const cryptoApi = globalThis.crypto

  if (cryptoApi && typeof cryptoApi.randomUUID === 'function') {
    return prefix + '-' + cryptoApi.randomUUID()
  }

  const bytes = new Uint8Array(16)
  cryptoApi.getRandomValues(bytes)

  return (
    prefix + '-' + Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  )
}

export function selectPrimaryDesignRoom(spatialModel: HomeSpatialModel): Room | undefined {
  const rooms = spatialModel.floors.flatMap((floor) => floor.rooms)

  return (
    rooms.find((room) => room.type === 'living') ??
    rooms.find((room) => room.type === 'dining') ??
    rooms.reduce<Room | undefined>((largest, room) => {
      if (!largest) return room

      return polygonArea(room.boundary) > polygonArea(largest.boundary) ? room : largest
    }, undefined)
  )
}

export const LAYOUT_REQUEST_SUFFIX = '生成现代原木风基础软装布局'

export function buildLayoutOperations(room: Room): {
  request: string
  operations: DesignOperation[]
} {
  const scope = { type: 'room', roomId: room.id } as const

  return {
    request: '为' + room.name + LAYOUT_REQUEST_SUFFIX,
    operations: [
      {
        id: createClientId('op-sofa'),
        type: 'add_object',
        source: 'user',
        scope,
        category: 'sofa',
        requirements: { style: 'warm-modern', minSeats: 3, maxWidth: 2.3 },
      },
      {
        id: createClientId('op-table'),
        type: 'add_object',
        source: 'user',
        scope,
        category: 'coffee_table',
        requirements: { style: 'warm-modern', maxWidth: 1.3 },
      },
      {
        id: createClientId('op-plant'),
        type: 'add_object',
        source: 'user',
        scope,
        category: 'plant',
        requirements: { styleTags: ['warm-modern', 'greenery'] },
      },
    ],
  }
}

export function buildCompactSofaOperations(
  sofa: DesignObject,
  allObjects: readonly DesignObject[],
): { request: string; operations: DesignOperation[] } {
  return {
    request: '沙发小一点，换成浅灰色三人位，其他家具保持不变',
    operations: [
      {
        id: createClientId('op-replace'),
        type: 'replace_object',
        source: 'user',
        scope: { type: 'object', objectId: sofa.id },
        objectId: sofa.id,
        requirements: {
          maxWidth: 1.95,
          minSeats: 3,
          colorFamily: 'light-gray',
          style: 'warm-modern',
        },
      },
      ...allObjects
        .filter((object) => object.id !== sofa.id)
        .map(
          (object): DesignOperation => ({
            id: createClientId('op-preserve'),
            type: 'preserve',
            source: 'user',
            scope: { type: 'object', objectId: object.id },
            targetId: object.id,
          }),
        ),
    ],
  }
}

export function buildSofaLockOperations(
  sofa: DesignObject,
  locked: boolean,
): { request: string; operations: DesignOperation[] } {
  return {
    request: locked ? '解除沙发锁定' : '锁定沙发，后续自动设计不要修改',
    operations: [
      {
        id: createClientId('op-lock'),
        type: locked ? 'unlock' : 'lock',
        source: 'user',
        scope: { type: 'object', objectId: sofa.id },
        targetId: sofa.id,
      },
    ],
  }
}
