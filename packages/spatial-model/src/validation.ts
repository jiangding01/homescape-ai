import { distance2D, polygonArea } from './geometry'
import type {
  Floor,
  HomeSpatialModel,
  Opening,
  Room,
  SpatialEntity,
  SpatialId,
  Wall,
} from './model'

export type SpatialValidationSeverity = 'warning' | 'error'

export interface SpatialValidationIssue {
  code: string
  severity: SpatialValidationSeverity
  path: string
  message: string
  entityId?: SpatialId
}

export interface SpatialValidationResult {
  valid: boolean
  issues: SpatialValidationIssue[]
}

const EPSILON = 0.001

function finite(value: number) {
  return Number.isFinite(value)
}

function validateProvenance(
  entity: SpatialEntity,
  path: string,
  issues: SpatialValidationIssue[],
) {
  const confidence = entity.provenance?.confidence

  if (confidence !== undefined && (confidence < 0 || confidence > 1)) {
    issues.push({
      code: 'provenance.confidence.out_of_range',
      severity: 'error',
      path: path + '.provenance.confidence',
      message: 'confidence 必须位于 0 到 1 之间',
      entityId: entity.id,
    })
  }
}

function validateWall(wall: Wall, path: string, issues: SpatialValidationIssue[]) {
  validateProvenance(wall, path, issues)

  if (distance2D(wall.start, wall.end) <= EPSILON) {
    issues.push({
      code: 'wall.zero_length',
      severity: 'error',
      path,
      message: '墙体长度必须大于 0',
      entityId: wall.id,
    })
  }

  if (!finite(wall.thickness) || wall.thickness <= 0) {
    issues.push({
      code: 'wall.invalid_thickness',
      severity: 'error',
      path: path + '.thickness',
      message: '墙体厚度必须为正数',
      entityId: wall.id,
    })
  }

  if (!finite(wall.height) || wall.height <= 0) {
    issues.push({
      code: 'wall.invalid_height',
      severity: 'error',
      path: path + '.height',
      message: '墙体高度必须为正数',
      entityId: wall.id,
    })
  }
}

function validateOpening(
  opening: Opening,
  wallMap: Map<SpatialId, Wall>,
  path: string,
  issues: SpatialValidationIssue[],
) {
  validateProvenance(opening, path, issues)

  const wall = wallMap.get(opening.wallId)

  if (!wall) {
    issues.push({
      code: 'opening.wall_missing',
      severity: 'error',
      path: path + '.wallId',
      message: '开口引用的墙体不存在',
      entityId: opening.id,
    })
    return
  }

  if (
    !finite(opening.offset) ||
    !finite(opening.width) ||
    !finite(opening.height) ||
    opening.offset < 0 ||
    opening.width <= 0 ||
    opening.height <= 0
  ) {
    issues.push({
      code: 'opening.invalid_dimensions',
      severity: 'error',
      path,
      message: '开口尺寸必须有效且为正数',
      entityId: opening.id,
    })
    return
  }

  if (opening.offset + opening.width > distance2D(wall.start, wall.end) + EPSILON) {
    issues.push({
      code: 'opening.outside_wall',
      severity: 'error',
      path,
      message: '开口超出了所属墙体范围',
      entityId: opening.id,
    })
  }

  if (opening.sillHeight !== undefined && opening.sillHeight < 0) {
    issues.push({
      code: 'opening.invalid_sill_height',
      severity: 'error',
      path: path + '.sillHeight',
      message: '窗台高度不能为负数',
      entityId: opening.id,
    })
  }
}

function validateRoom(
  room: Room,
  floor: Floor,
  path: string,
  wallMap: Map<SpatialId, Wall>,
  openingMap: Map<SpatialId, Opening>,
  issues: SpatialValidationIssue[],
) {
  validateProvenance(room, path, issues)

  if (room.boundary.points.length < 3 || polygonArea(room.boundary) <= EPSILON) {
    issues.push({
      code: 'room.invalid_boundary',
      severity: 'error',
      path: path + '.boundary',
      message: '房间边界必须是面积大于 0 的多边形',
      entityId: room.id,
    })
  }

  if (!finite(room.ceilingHeight) || room.ceilingHeight <= 0) {
    issues.push({
      code: 'room.invalid_ceiling_height',
      severity: 'error',
      path: path + '.ceilingHeight',
      message: '层高必须为正数',
      entityId: room.id,
    })
  }

  for (const wallId of room.wallIds) {
    if (!wallMap.has(wallId)) {
      issues.push({
        code: 'room.wall_missing',
        severity: 'error',
        path: path + '.wallIds',
        message: '房间引用了不存在的墙体：' + wallId,
        entityId: room.id,
      })
    }
  }

  for (const openingId of room.openingIds) {
    if (!openingMap.has(openingId)) {
      issues.push({
        code: 'room.opening_missing',
        severity: 'error',
        path: path + '.openingIds',
        message: '房间引用了不存在的开口：' + openingId,
        entityId: room.id,
      })
    }
  }

  room.zones.forEach((zone, zoneIndex) => {
    const zonePath = path + '.zones[' + zoneIndex + ']'
    validateProvenance(zone, zonePath, issues)

    if (zone.boundary.points.length < 3 || polygonArea(zone.boundary) <= EPSILON) {
      issues.push({
        code: 'zone.invalid_boundary',
        severity: 'error',
        path: zonePath + '.boundary',
        message: '功能分区边界必须是面积大于 0 的多边形',
        entityId: zone.id,
      })
    }
  })

  if (floor.rooms.filter((candidate) => candidate.id === room.id).length > 1) {
    issues.push({
      code: 'room.duplicate_id',
      severity: 'error',
      path: path + '.id',
      message: '同一楼层中存在重复房间 ID',
      entityId: room.id,
    })
  }
}

function validateUniqueIds(model: HomeSpatialModel, issues: SpatialValidationIssue[]) {
  const seen = new Map<SpatialId, string>()

  const visit = (entity: SpatialEntity, path: string) => {
    const previousPath = seen.get(entity.id)

    if (previousPath) {
      issues.push({
        code: 'entity.duplicate_id',
        severity: 'error',
        path,
        message: '空间实体 ID 重复，首次出现于 ' + previousPath,
        entityId: entity.id,
      })
      return
    }

    seen.set(entity.id, path)
  }

  model.floors.forEach((floor, floorIndex) => {
    const floorPath = 'floors[' + floorIndex + ']'
    visit(floor, floorPath)

    floor.walls.forEach((wall, index) => visit(wall, floorPath + '.walls[' + index + ']'))
    floor.openings.forEach((opening, index) =>
      visit(opening, floorPath + '.openings[' + index + ']'),
    )
    floor.structuralElements.forEach((element, index) =>
      visit(element, floorPath + '.structuralElements[' + index + ']'),
    )
    floor.utilityAnchors.forEach((anchor, index) =>
      visit(anchor, floorPath + '.utilityAnchors[' + index + ']'),
    )
    floor.connections.forEach((connection, index) =>
      visit(connection, floorPath + '.connections[' + index + ']'),
    )

    floor.rooms.forEach((room, roomIndex) => {
      const roomPath = floorPath + '.rooms[' + roomIndex + ']'
      visit(room, roomPath)
      room.zones.forEach((zone, zoneIndex) => visit(zone, roomPath + '.zones[' + zoneIndex + ']'))
    })
  })
}

export function validateHomeSpatialModel(model: HomeSpatialModel): SpatialValidationResult {
  const issues: SpatialValidationIssue[] = []

  if (!model.schemaVersion.trim()) {
    issues.push({
      code: 'model.schema_version_missing',
      severity: 'error',
      path: 'schemaVersion',
      message: 'schemaVersion 不能为空',
    })
  }

  if (model.floors.length === 0) {
    issues.push({
      code: 'model.floor_missing',
      severity: 'error',
      path: 'floors',
      message: '住宅空间至少需要一个楼层',
    })
  }

  if (model.provenance?.confidence !== undefined) {
    const confidence = model.provenance.confidence
    if (confidence < 0 || confidence > 1) {
      issues.push({
        code: 'model.confidence.out_of_range',
        severity: 'error',
        path: 'provenance.confidence',
        message: '模型整体 confidence 必须位于 0 到 1 之间',
      })
    }
  }

  validateUniqueIds(model, issues)

  model.floors.forEach((floor, floorIndex) => {
    const floorPath = 'floors[' + floorIndex + ']'
    validateProvenance(floor, floorPath, issues)

    const wallMap = new Map(floor.walls.map((wall) => [wall.id, wall]))
    const openingMap = new Map(floor.openings.map((opening) => [opening.id, opening]))
    const roomMap = new Map(floor.rooms.map((room) => [room.id, room]))

    floor.walls.forEach((wall, index) =>
      validateWall(wall, floorPath + '.walls[' + index + ']', issues),
    )
    floor.openings.forEach((opening, index) =>
      validateOpening(opening, wallMap, floorPath + '.openings[' + index + ']', issues),
    )
    floor.rooms.forEach((room, index) =>
      validateRoom(
        room,
        floor,
        floorPath + '.rooms[' + index + ']',
        wallMap,
        openingMap,
        issues,
      ),
    )

    floor.structuralElements.forEach((element, index) => {
      const path = floorPath + '.structuralElements[' + index + ']'
      validateProvenance(element, path, issues)

      if (element.kind === 'column') {
        if (element.size[0] <= 0 || element.size[1] <= 0 || element.height <= 0) {
          issues.push({
            code: 'structure.invalid_column',
            severity: 'error',
            path,
            message: '柱体尺寸必须为正数',
            entityId: element.id,
          })
        }
      } else if (
        distance2D(element.start, element.end) <= EPSILON ||
        element.width <= 0 ||
        element.height <= 0
      ) {
        issues.push({
          code: 'structure.invalid_beam',
          severity: 'error',
          path,
          message: '梁的长度、宽度和高度必须为正数',
          entityId: element.id,
        })
      }
    })

    floor.utilityAnchors.forEach((anchor, index) => {
      const path = floorPath + '.utilityAnchors[' + index + ']'
      validateProvenance(anchor, path, issues)

      if (anchor.roomId && !roomMap.has(anchor.roomId)) {
        issues.push({
          code: 'utility.room_missing',
          severity: 'error',
          path: path + '.roomId',
          message: '设备锚点引用的房间不存在',
          entityId: anchor.id,
        })
      }
    })

    floor.connections.forEach((connection, index) => {
      const path = floorPath + '.connections[' + index + ']'
      validateProvenance(connection, path, issues)

      if (!roomMap.has(connection.fromRoomId) || !roomMap.has(connection.toRoomId)) {
        issues.push({
          code: 'connection.room_missing',
          severity: 'error',
          path,
          message: '空间连接引用了不存在的房间',
          entityId: connection.id,
        })
      }

      if (connection.fromRoomId === connection.toRoomId) {
        issues.push({
          code: 'connection.self_reference',
          severity: 'error',
          path,
          message: '空间连接不能连接同一个房间',
          entityId: connection.id,
        })
      }

      if (connection.openingId && !openingMap.has(connection.openingId)) {
        issues.push({
          code: 'connection.opening_missing',
          severity: 'error',
          path: path + '.openingId',
          message: '空间连接引用的开口不存在',
          entityId: connection.id,
        })
      }
    })
  })

  return {
    valid: !issues.some((issue) => issue.severity === 'error'),
    issues,
  }
}

export function assertValidHomeSpatialModel(model: HomeSpatialModel) {
  const result = validateHomeSpatialModel(model)

  if (!result.valid) {
    const summary = result.issues
      .filter((issue) => issue.severity === 'error')
      .map((issue) => issue.path + ': ' + issue.message)
      .join('\n')

    throw new Error('HomeSpatialModel 校验失败：\n' + summary)
  }

  return model
}
