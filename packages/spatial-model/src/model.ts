import type { Polygon2D, Vec2, Vec3 } from './geometry'
import type { SpatialProvenance } from './provenance'

export type SpatialId = string

export interface SpatialEntity {
  id: SpatialId
  provenance?: SpatialProvenance
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
  | 'utility'
  | 'other'

export type ZoneFunction =
  | RoomType
  | 'reading'
  | 'work'
  | 'storage'
  | 'entry'
  | 'circulation'
  | 'custom'

export interface Wall extends SpatialEntity {
  start: Vec2
  end: Vec2
  thickness: number
  height: number
}

export interface Opening extends SpatialEntity {
  wallId: SpatialId
  kind: 'door' | 'window' | 'opening'
  offset: number
  width: number
  height: number
  sillHeight?: number
  swing?: 'left' | 'right' | 'double' | 'sliding' | 'none'
}

export interface Zone extends SpatialEntity {
  name: string
  function: ZoneFunction
  boundary: Polygon2D
}

export interface Room extends SpatialEntity {
  name: string
  type: RoomType
  boundary: Polygon2D
  ceilingHeight: number
  wallIds: SpatialId[]
  openingIds: SpatialId[]
  zones: Zone[]
}

export interface Column extends SpatialEntity {
  kind: 'column'
  center: Vec2
  size: Vec2
  height: number
  rotation: number
}

export interface Beam extends SpatialEntity {
  kind: 'beam'
  start: Vec2
  end: Vec2
  width: number
  height: number
  bottomElevation: number
}

export type StructuralElement = Column | Beam

export interface UtilityAnchor extends SpatialEntity {
  kind: 'electrical' | 'plumbing' | 'hvac' | 'gas' | 'drain' | 'other'
  position: Vec3
  roomId?: SpatialId
  metadata?: Record<string, string | number | boolean>
}

export interface RoomConnection extends SpatialEntity {
  fromRoomId: SpatialId
  toRoomId: SpatialId
  kind: 'door' | 'opening' | 'open_plan'
  openingId?: SpatialId
}

export interface Floor extends SpatialEntity {
  name: string
  elevation: number
  rooms: Room[]
  walls: Wall[]
  openings: Opening[]
  structuralElements: StructuralElement[]
  utilityAnchors: UtilityAnchor[]
  connections: RoomConnection[]
}

export interface HomeSpatialModel {
  schemaVersion: string
  id: SpatialId
  name: string
  unit: 'meter'
  coordinateSystem: 'right-handed-y-up'
  floors: Floor[]
  provenance?: SpatialProvenance
  metadata?: {
    grossArea?: number
    addressLabel?: string
    sourceLabel?: string
  }
}
