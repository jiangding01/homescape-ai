export type SpatialId = string
export type Vec2 = readonly [x: number, z: number]
export type Vec3 = readonly [x: number, y: number, z: number]

export interface Polygon2D {
  points: Vec2[]
}

export type RoomType =
  | 'living'
  | 'dining'
  | 'kitchen'
  | 'bedroom'
  | 'bathroom'
  | 'study'
  | 'balcony'
  | 'hallway'
  | 'other'

export interface Wall {
  id: SpatialId
  start: Vec2
  end: Vec2
  thickness: number
  height: number
}

export interface Opening {
  id: SpatialId
  wallId: SpatialId
  kind: 'door' | 'window' | 'opening'
  offset: number
  width: number
  height: number
  sillHeight?: number
}

export interface Zone {
  id: SpatialId
  name: string
  function: RoomType | 'reading' | 'work' | 'storage' | 'custom'
  boundary: Polygon2D
}

export interface Room {
  id: SpatialId
  name: string
  type: RoomType
  boundary: Polygon2D
  ceilingHeight: number
  wallIds: SpatialId[]
  openingIds: SpatialId[]
  zones: Zone[]
  adjacentRoomIds: SpatialId[]
}

export interface Floor {
  id: SpatialId
  name: string
  elevation: number
  rooms: Room[]
  walls: Wall[]
  openings: Opening[]
}

export interface HomeSpatialModel {
  id: SpatialId
  name: string
  unit: 'meter'
  coordinateSystem: 'right-handed-y-up'
  floors: Floor[]
}
