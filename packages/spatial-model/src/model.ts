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

/**
 * 墙厚来源（ADR 0018）：
 * - paired：两侧房间内表面成对，厚度取图面实测间距（仍属从图面推断的 Candidate）
 * - exterior：外墙，只有一侧房间，厚度为假设值，需要人工确认
 * - coincident：两侧房间边界重合（疑似按墙中心线标注的旧数据），厚度为假设值
 */
export type WallThicknessSource = 'paired' | 'exterior' | 'coincident'

/**
 * 墙一侧的房间。edgeIndex 指 `Room.boundary.points[edgeIndex] → [edgeIndex + 1]` 这条边，
 * [edgeStart, edgeEnd] 是本墙段在该边上占据的区间（米，从边起点量起，edgeStart < edgeEnd）。
 */
export interface WallRoomSide {
  kind: 'room'
  roomId: SpatialId
  edgeIndex: number
  edgeStart: number
  edgeEnd: number
}

/** 墙一侧为室外（外墙）。 */
export interface WallExteriorSide {
  kind: 'exterior'
}

export type WallSide = WallRoomSide | WallExteriorSide

export interface Wall extends SpatialEntity {
  /** 墙中心线起点 */
  start: Vec2
  /** 墙中心线终点 */
  end: Vec2
  thickness: number
  height: number
  /** schemaVersion ≥ 0.3.0 由推导写入；旧数据缺省表示来源未知 */
  thicknessSource?: WallThicknessSource
  /**
   * 墙两侧的空间。sides[0] 位于墙方向 d = end − start 的俯视左侧（从 +Y 俯视，
   * 法线 (dz, −dx)/|d| 一侧），sides[1] 位于右侧（法线 (−dz, dx)/|d|）。
   * 旧数据（schemaVersion < 0.3.0）可能缺省，读取方需兼容。
   */
  sides?: readonly [WallSide, WallSide]
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
  /**
   * 房间净空地面轮廓，即墙体内表面（ADR 0018），单位米，
   * 从 +Y 俯视逆时针（见 polygon-ops.ts 的绕向约定）。
   */
  boundary: Polygon2D
  ceilingHeight: number
  /** 由墙体推导结果生成：两侧任一侧引用本房间的墙段 */
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

/**
 * 室外的保留 ID。RoomConnection.toRoomId 取该值表示连接到室外（如外墙上的入户门）。
 * 选择“特殊值”而非新增字段，是为了让现有按 fromRoomId / toRoomId 读取连接的代码
 * 保持可编译；房间 ID 不得使用该值（由 Validation 检查）。
 */
export const EXTERIOR_SPACE_ID = '__exterior__'

export function isExteriorConnection(connection: Pick<RoomConnection, 'toRoomId'>) {
  return connection.toRoomId === EXTERIOR_SPACE_ID
}

export interface RoomConnection extends SpatialEntity {
  fromRoomId: SpatialId
  /** 另一侧房间 ID；连接到室外时为 EXTERIOR_SPACE_ID */
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

/**
 * 当前 HomeSpatialModel 结构版本。
 * 0.3.0：房间边界为内表面且从 +Y 俯视逆时针；Wall 记录 sides / thicknessSource；
 * RoomConnection.toRoomId 可为 EXTERIOR_SPACE_ID。
 */
export const HOME_SPATIAL_MODEL_SCHEMA_VERSION = '0.3.0'

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
