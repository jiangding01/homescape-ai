import { EXTERIOR_SPACE_ID, type Floor, type RoomConnection, type RoomType, type SpatialId } from './model'

export interface RoomGraphNode {
  roomId: SpatialId
  name: string
  type: RoomType
}

export interface RoomGraphEdge {
  connectionId: SpatialId
  fromRoomId: SpatialId
  toRoomId: SpatialId
  kind: RoomConnection['kind']
  openingId?: SpatialId
}

export interface RoomGraph {
  nodes: RoomGraphNode[]
  edges: RoomGraphEdge[]
  /** 房间之间的邻接；连接到室外（EXTERIOR_SPACE_ID）的边只出现在 edges 中 */
  neighbors: ReadonlyMap<SpatialId, readonly SpatialId[]>
}

export function buildRoomGraph(floor: Floor): RoomGraph {
  const neighborSets = new Map<SpatialId, Set<SpatialId>>()

  for (const room of floor.rooms) {
    neighborSets.set(room.id, new Set())
  }

  const edges: RoomGraphEdge[] = floor.connections.map((connection) => {
    if (connection.toRoomId !== EXTERIOR_SPACE_ID) {
      neighborSets.get(connection.fromRoomId)?.add(connection.toRoomId)
      neighborSets.get(connection.toRoomId)?.add(connection.fromRoomId)
    }

    const edge: RoomGraphEdge = {
      connectionId: connection.id,
      fromRoomId: connection.fromRoomId,
      toRoomId: connection.toRoomId,
      kind: connection.kind,
    }

    if (connection.openingId) edge.openingId = connection.openingId

    return edge
  })

  return {
    nodes: floor.rooms.map((room) => ({
      roomId: room.id,
      name: room.name,
      type: room.type,
    })),
    edges,
    neighbors: new Map(
      [...neighborSets.entries()].map(([roomId, neighbors]) => [roomId, [...neighbors]]),
    ),
  }
}

export function getAdjacentRoomIds(floor: Floor, roomId: SpatialId) {
  return buildRoomGraph(floor).neighbors.get(roomId) ?? []
}
