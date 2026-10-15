import { distance2D, polygonArea, type Polygon2D, type Vec2 } from './geometry'
import {
  getFloorPlanCalibrationAxisError,
  type FloorPlanCalibration,
  type FloorPlanCalibrationAxis,
  type FloorPlanDraft,
  type FloorPlanDraftOpening,
  type FloorPlanDraftRoom,
  type PixelPoint,
} from './floorplan-draft'
import {
  EXTERIOR_SPACE_ID,
  HOME_SPATIAL_MODEL_SCHEMA_VERSION,
  type Floor,
  type HomeSpatialModel,
  type Opening,
  type Room,
  type RoomConnection,
  type RoomType,
  type SpatialId,
  type Wall,
  type WallRoomSide,
} from './model'
import type {
  SpatialImportContext,
  SpatialImporter,
  SpatialImportResult,
  SpatialUnresolvedIssue,
} from './importer'
import { ensureCounterClockwise, reversedEdgeIndex } from './polygon-ops'
import { validateHomeSpatialModel } from './validation'
import {
  bindRoomEdgeSpanToWall,
  inferWallsFromRooms,
  isExteriorWall,
  wallRoomSides,
  type WallInferenceOptions,
} from './wall-inference'

const DEFAULT_CONFIDENCE_THRESHOLD = 0.75
const SPAN_TOLERANCE_METERS = 0.001

export interface FloorPlanDraftScale {
  /** 横向每米像素数（sx） */
  pixelsPerMeterX: number
  /** 纵向每米像素数（sy），未提供 calibrationY 时等于 sx */
  pixelsPerMeterY: number
}

/** 导入后的房间几何：统一为从 +Y 俯视逆时针，并记录与 Draft 边索引的对应关系 */
interface ImportedRoomGeometry {
  draft: FloorPlanDraftRoom
  boundary: Polygon2D
  /** true 表示 Draft 原绕向为顺时针，已反转；Draft 第 i 条边对应模型第 n−1−i 条边且方向相反 */
  reversed: boolean
}

export interface FloorPlanDraftImporterOptions {
  confidenceThreshold?: number
  /**
   * 成对边推导墙体的参数。外墙假设厚度固定取 Draft 的 assumptions.wallThicknessMeters，
   * 墙段 ID 前缀固定为 `<projectId>-wall`。
   */
  wallInference?: Omit<WallInferenceOptions, 'exteriorThickness' | 'idPrefix'>
}

function assertPositiveFinite(value: number, label: string) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(label + ' 必须为正数')
  }
}

function assertNonNegativeFinite(value: number, label: string) {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(label + ' 必须是非负数')
  }
}

function assertConfidence(value: number | undefined, label: string) {
  if (value !== undefined && (!Number.isFinite(value) || value < 0 || value > 1)) {
    throw new Error(label + ' 必须位于 0 到 1 之间')
  }
}

function assertPixelPointWithinSource(
  point: PixelPoint,
  widthPx: number,
  heightPx: number,
  label: string,
) {
  if (
    !Number.isFinite(point[0]) ||
    !Number.isFinite(point[1]) ||
    point[0] < 0 ||
    point[0] > widthPx ||
    point[1] < 0 ||
    point[1] > heightPx
  ) {
    throw new Error(label + ' 超出户型图像素范围')
  }
}

function pixelDistance(a: PixelPoint, b: PixelPoint) {
  return Math.hypot(b[0] - a[0], b[1] - a[1])
}

function calibrationPixelsPerMeter(
  calibration: FloorPlanCalibration,
  label: string,
  widthPx: number,
  heightPx: number,
) {
  assertPositiveFinite(calibration.realDistanceMeters, label + '.realDistanceMeters')
  assertPixelPointWithinSource(calibration.startPx, widthPx, heightPx, label + '.startPx')
  assertPixelPointWithinSource(calibration.endPx, widthPx, heightPx, label + '.endPx')

  const distancePx = pixelDistance(calibration.startPx, calibration.endPx)
  assertPositiveFinite(distancePx, label + ' pixel distance')

  return distancePx / calibration.realDistanceMeters
}

/**
 * 解析 FloorPlanDraft 的像素 → 米比例：calibration 给出 sx，
 * calibrationY 给出 sy；只有一条标定时按等比处理（sy = sx）。
 */
export function resolveFloorPlanDraftScale(
  draft: Pick<FloorPlanDraft, 'source' | 'calibration' | 'calibrationY'>,
): FloorPlanDraftScale {
  const { widthPx, heightPx } = draft.source
  const pixelsPerMeterX = calibrationPixelsPerMeter(
    draft.calibration,
    'calibration',
    widthPx,
    heightPx,
  )

  if (!draft.calibrationY) {
    return { pixelsPerMeterX, pixelsPerMeterY: pixelsPerMeterX }
  }

  const axisErrors: Array<[FloorPlanCalibration, FloorPlanCalibrationAxis]> = [
    [draft.calibration, 'x'],
    [draft.calibrationY, 'y'],
  ]

  for (const [calibration, axis] of axisErrors) {
    const error = getFloorPlanCalibrationAxisError(calibration, axis)
    if (error) throw new Error(error)
  }

  return {
    pixelsPerMeterX,
    pixelsPerMeterY: calibrationPixelsPerMeter(
      draft.calibrationY,
      'calibrationY',
      widthPx,
      heightPx,
    ),
  }
}

function confidenceIssue(
  id: string,
  entityIds: SpatialId[],
  confidence: number | undefined,
  threshold: number,
  label: string,
): SpatialUnresolvedIssue | undefined {
  if (confidence === undefined || confidence >= threshold) return undefined

  return {
    id,
    kind: 'low_confidence',
    message:
      label + '置信度为 ' + confidence.toFixed(2) + '，低于自动确认阈值 ' + threshold.toFixed(2),
    entityIds,
    confidence,
    requiresHumanReview: true,
  }
}

function averageConfidence(values: Array<number | undefined>) {
  const known = values.filter(
    (value): value is number => value !== undefined && Number.isFinite(value),
  )

  if (known.length === 0) return undefined

  return known.reduce((sum, value) => sum + value, 0) / known.length
}

function minConfidence(values: Array<number | undefined>) {
  const known = values.filter(
    (value): value is number => value !== undefined && Number.isFinite(value),
  )

  return known.length > 0 ? Math.min(...known) : undefined
}

function roomType(room: FloorPlanDraftRoom): RoomType {
  return room.type ?? 'other'
}

export class FloorPlanDraftImporter implements SpatialImporter<FloorPlanDraft> {
  readonly id = 'floorplan-draft-v0.2'

  private readonly confidenceThreshold: number
  private readonly wallInferenceOptions: Omit<
    WallInferenceOptions,
    'exteriorThickness' | 'idPrefix'
  >

  constructor(options: FloorPlanDraftImporterOptions = {}) {
    this.confidenceThreshold = options.confidenceThreshold ?? DEFAULT_CONFIDENCE_THRESHOLD
    this.wallInferenceOptions = options.wallInference ?? {}
  }

  supports(sourceKind: SpatialImportContext['sourceKind']) {
    return (
      sourceKind === 'floorplan_image' ||
      sourceKind === 'floorplan_pdf' ||
      sourceKind === 'company_data'
    )
  }

  async parse(input: FloorPlanDraft, context: SpatialImportContext): Promise<SpatialImportResult> {
    if (!this.supports(input.source.kind) || context.sourceKind !== input.source.kind) {
      throw new Error('FloorPlanDraft source.kind 与 Import Context 不匹配或不受支持')
    }

    assertPositiveFinite(input.source.widthPx, 'source.widthPx')
    assertPositiveFinite(input.source.heightPx, 'source.heightPx')
    assertPositiveFinite(input.assumptions.wallThicknessMeters, 'assumptions.wallThicknessMeters')
    assertPositiveFinite(input.assumptions.ceilingHeightMeters, 'assumptions.ceilingHeightMeters')

    const { pixelsPerMeterX, pixelsPerMeterY } = resolveFloorPlanDraftScale(input)

    const draftIds = new Set<string>()

    for (const room of input.rooms) {
      if (draftIds.has(room.id)) {
        throw new Error('FloorPlanDraft 存在重复实体 ID：' + room.id)
      }

      draftIds.add(room.id)
    }

    for (const opening of input.openings) {
      if (draftIds.has(opening.id)) {
        throw new Error('FloorPlanDraft 存在重复实体 ID：' + opening.id)
      }

      draftIds.add(opening.id)
    }

    for (const [roomIndex, room] of input.rooms.entries()) {
      assertConfidence(room.confidence, 'rooms[' + roomIndex + '].confidence')

      for (const [pointIndex, point] of room.boundaryPx.entries()) {
        assertPixelPointWithinSource(
          point,
          input.source.widthPx,
          input.source.heightPx,
          'rooms[' + roomIndex + '].boundaryPx[' + pointIndex + ']',
        )
      }
    }

    for (const [openingIndex, opening] of input.openings.entries()) {
      assertConfidence(opening.confidence, 'openings[' + openingIndex + '].confidence')
    }

    const allPoints = input.rooms.flatMap((room) => room.boundaryPx)

    if (allPoints.length === 0) {
      throw new Error('FloorPlanDraft 至少需要一个房间边界')
    }

    const toRawWorld = (point: PixelPoint): Vec2 => [
      point[0] / pixelsPerMeterX,
      (input.source.heightPx - point[1]) / pixelsPerMeterY,
    ]

    const rawWorldPoints = allPoints.map(toRawWorld)
    const minX = Math.min(...rawWorldPoints.map((point) => point[0]))
    const minZ = Math.min(...rawWorldPoints.map((point) => point[1]))

    const toWorld = (point: PixelPoint): Vec2 => {
      const raw = toRawWorld(point)
      return [raw[0] - minX, raw[1] - minZ]
    }

    const unresolved: SpatialUnresolvedIssue[] = []
    const geometries = new Map<SpatialId, ImportedRoomGeometry>()

    for (const draftRoom of input.rooms) {
      if (draftRoom.boundaryPx.length < 3) {
        unresolved.push({
          id: 'issue-room-boundary-' + draftRoom.id,
          kind: 'topology_conflict',
          message: draftRoom.name + ' 的边界点不足 3 个',
          entityIds: [draftRoom.id],
          requiresHumanReview: true,
        })
      }

      for (let edgeIndex = 0; edgeIndex < draftRoom.boundaryPx.length; edgeIndex += 1) {
        const startPx = draftRoom.boundaryPx[edgeIndex]!
        const endPx = draftRoom.boundaryPx[(edgeIndex + 1) % draftRoom.boundaryPx.length]!

        if (pixelDistance(startPx, endPx) <= 0.001) {
          throw new Error(draftRoom.name + ' 的边界包含零长度边，请先修正 FloorPlanDraft')
        }
      }

      // 房间边界即墙体内表面，不做偏移；只统一绕向。
      const { polygon, reversed } = ensureCounterClockwise({
        points: draftRoom.boundaryPx.map(toWorld),
      })

      geometries.set(draftRoom.id, { draft: draftRoom, boundary: polygon, reversed })
    }

    const inference = inferWallsFromRooms(
      [...geometries.values()].map(({ draft, boundary }) => ({ id: draft.id, boundary })),
      {
        ...this.wallInferenceOptions,
        exteriorThickness: input.assumptions.wallThicknessMeters,
        idPrefix: context.projectId + '-wall',
      },
    )

    const baseProvenance = {
      sourceKind: context.sourceKind,
      ...(context.sourceId ? { sourceId: context.sourceId } : {}),
      importerId: this.id,
    }

    const walls: Wall[] = inference.walls.map((inferred) => {
      const confidence = minConfidence(
        inferred.sides
          .filter((side): side is WallRoomSide => side.kind === 'room')
          .map((side) => geometries.get(side.roomId)?.draft.confidence),
      )

      return {
        id: inferred.id,
        start: inferred.start,
        end: inferred.end,
        thickness: inferred.thickness,
        height: input.assumptions.ceilingHeightMeters,
        thicknessSource: inferred.thicknessSource,
        sides: inferred.sides,
        provenance: {
          ...baseProvenance,
          ...(confidence !== undefined ? { confidence } : {}),
        },
      }
    })

    const rooms: Room[] = []

    for (const { draft: draftRoom, boundary } of geometries.values()) {
      rooms.push({
        id: draftRoom.id,
        name: draftRoom.name,
        type: roomType(draftRoom),
        boundary,
        ceilingHeight: input.assumptions.ceilingHeightMeters,
        wallIds: [...(inference.roomWallIds.get(draftRoom.id) ?? [])],
        openingIds: [],
        zones: [],
        provenance: {
          ...baseProvenance,
          ...(draftRoom.confidence !== undefined ? { confidence: draftRoom.confidence } : {}),
        },
      })

      if (!draftRoom.type) {
        unresolved.push({
          id: 'issue-room-type-' + draftRoom.id,
          kind: 'unknown_room_type',
          message: draftRoom.name + ' 的房间类型需要人工确认',
          entityIds: [draftRoom.id],
          ...(draftRoom.confidence !== undefined ? { confidence: draftRoom.confidence } : {}),
          requiresHumanReview: true,
        })
      }

      const lowConfidence = confidenceIssue(
        'issue-room-confidence-' + draftRoom.id,
        [draftRoom.id],
        draftRoom.confidence,
        this.confidenceThreshold,
        draftRoom.name,
      )

      if (lowConfidence) unresolved.push(lowConfidence)

      if (polygonArea(boundary) <= 0.001) {
        unresolved.push({
          id: 'issue-room-area-' + draftRoom.id,
          kind: 'topology_conflict',
          message: draftRoom.name + ' 的房间边界面积无效',
          entityIds: [draftRoom.id],
          requiresHumanReview: true,
        })
      }
    }

    const assumedThicknessWalls = walls.filter((wall) => wall.thicknessSource !== 'paired')

    if (!input.assumptions.wallThicknessConfirmed && assumedThicknessWalls.length > 0) {
      unresolved.push({
        id: 'issue-wall-thickness-assumption',
        kind: 'missing_dimension',
        message:
          '外墙（及边界重合处）墙厚当前使用 ' +
          input.assumptions.wallThicknessMeters.toFixed(3) +
          'm 假设值，需要确认',
        entityIds: assumedThicknessWalls.map((wall) => wall.id),
        requiresHumanReview: true,
      })
    }

    const coincidentWalls = walls.filter((wall) => wall.thicknessSource === 'coincident')

    if (coincidentWalls.length > 0) {
      unresolved.push({
        id: 'issue-wall-coincident-boundaries',
        kind: 'topology_conflict',
        message:
          coincidentWalls.length +
          ' 段墙两侧的房间边界重合，疑似按墙中心线标注；房间边界应为墙体内表面，需要复核',
        entityIds: coincidentWalls.map((wall) => wall.id),
        requiresHumanReview: true,
      })
    }

    if (!input.assumptions.ceilingHeightConfirmed) {
      unresolved.push({
        id: 'issue-ceiling-height-assumption',
        kind: 'missing_dimension',
        message:
          '层高当前使用 ' + input.assumptions.ceilingHeightMeters.toFixed(2) + 'm 假设值，需要确认',
        entityIds: rooms.map((room) => room.id),
        requiresHumanReview: true,
      })
    }

    const scaleTargets: Array<{
      id: string
      label: string
      calibration: FloorPlanCalibration
      pixelsPerMeter: number
    }> = input.calibrationY
      ? [
          {
            id: 'issue-calibration-x-assumption',
            label: '横向比例尺',
            calibration: input.calibration,
            pixelsPerMeter: pixelsPerMeterX,
          },
          {
            id: 'issue-calibration-y-assumption',
            label: '纵向比例尺',
            calibration: input.calibrationY,
            pixelsPerMeter: pixelsPerMeterY,
          },
        ]
      : [
          {
            id: 'issue-calibration-assumption',
            label: '比例尺',
            calibration: input.calibration,
            pixelsPerMeter: pixelsPerMeterX,
          },
        ]

    for (const target of scaleTargets) {
      if (target.calibration.basis !== 'assumed') continue

      unresolved.push({
        id: target.id,
        kind: 'missing_dimension',
        message:
          target.label +
          '当前使用 ' +
          target.pixelsPerMeter.toFixed(2) +
          ' px/m 假设值，需要按图上尺寸线确认',
        entityIds: rooms.map((room) => room.id),
        requiresHumanReview: true,
      })
    }

    const openings: Opening[] = []
    const connections: RoomConnection[] = []
    const wallById = new Map(walls.map((wall) => [wall.id, wall]))
    const roomById = new Map(rooms.map((room) => [room.id, room]))

    for (const draftOpening of input.openings) {
      const imported = this.importOpening(
        draftOpening,
        context,
        geometries,
        toWorld,
        walls,
        unresolved,
      )

      if (!imported) continue

      openings.push(imported)

      const wall = wallById.get(imported.wallId)
      const roomSides = wallRoomSides(wall)

      for (const side of roomSides) {
        roomById.get(side.roomId)?.openingIds.push(imported.id)
      }

      if (imported.kind === 'window') continue

      const otherRoom = roomSides.find((side) => side.roomId !== draftOpening.roomId)
      const connectionProvenance = {
        ...baseProvenance,
        ...(imported.provenance?.confidence !== undefined
          ? { confidence: imported.provenance.confidence }
          : {}),
      }

      if (otherRoom) {
        connections.push({
          id: context.projectId + '-connection-' + imported.id,
          fromRoomId: draftOpening.roomId,
          toRoomId: otherRoom.roomId,
          kind: imported.kind === 'door' ? 'door' : 'opening',
          openingId: imported.id,
          provenance: connectionProvenance,
        })
      } else if (isExteriorWall(wall) && imported.kind === 'door') {
        // 外墙上的门连接到室外（入户门、阳台门等）。外墙上的“开口”不推导连接。
        connections.push({
          id: context.projectId + '-connection-' + imported.id,
          fromRoomId: draftOpening.roomId,
          toRoomId: EXTERIOR_SPACE_ID,
          kind: 'door',
          openingId: imported.id,
          provenance: connectionProvenance,
        })
      }
    }

    for (const room of rooms) {
      room.openingIds = [...new Set(room.openingIds)]
    }

    const overallConfidence = averageConfidence([
      ...input.rooms.map((room) => room.confidence),
      ...input.openings.map((opening) => opening.confidence),
    ])

    const floor: Floor = {
      id: context.projectId + '-floor-imported-1',
      name: '导入楼层',
      elevation: 0,
      rooms,
      walls,
      openings,
      structuralElements: [],
      utilityAnchors: [],
      connections,
      provenance: {
        ...baseProvenance,
        ...(overallConfidence !== undefined ? { confidence: overallConfidence } : {}),
      },
    }

    const model: HomeSpatialModel = {
      schemaVersion: HOME_SPATIAL_MODEL_SCHEMA_VERSION,
      id: context.projectId + '-spatial',
      name: context.projectName,
      unit: 'meter',
      coordinateSystem: 'right-handed-y-up',
      floors: [floor],
      provenance: {
        ...baseProvenance,
        ...(overallConfidence !== undefined ? { confidence: overallConfidence } : {}),
      },
      metadata: {
        sourceLabel: context.sourceLabel ?? input.source.sourceLabel,
      },
    }

    return {
      model,
      validation: validateHomeSpatialModel(model),
      unresolved,
      ...(overallConfidence !== undefined ? { overallConfidence } : {}),
    }
  }

  private importOpening(
    draft: FloorPlanDraftOpening,
    context: SpatialImportContext,
    geometries: Map<SpatialId, ImportedRoomGeometry>,
    toWorld: (point: PixelPoint) => Vec2,
    walls: Wall[],
    unresolved: SpatialUnresolvedIssue[],
  ) {
    const confidenceField = draft.confidence !== undefined ? { confidence: draft.confidence } : {}
    const geometry = geometries.get(draft.roomId)
    const pointCount = geometry?.draft.boundaryPx.length ?? 0
    const startPx = geometry?.draft.boundaryPx[draft.edgeIndex]
    const endPx = geometry?.draft.boundaryPx[(draft.edgeIndex + 1) % Math.max(pointCount, 1)]

    if (!geometry || !Number.isInteger(draft.edgeIndex) || !startPx || !endPx) {
      unresolved.push({
        id: 'issue-opening-edge-' + draft.id,
        kind: 'ambiguous_opening',
        message:
          '开口 ' +
          draft.id +
          ' 无法匹配房间 ' +
          draft.roomId +
          ' 的第 ' +
          draft.edgeIndex +
          ' 条边',
        entityIds: [draft.id, draft.roomId],
        ...confidenceField,
        requiresHumanReview: true,
      })
      return undefined
    }

    assertNonNegativeFinite(draft.offsetPx, 'opening.offsetPx')
    assertPositiveFinite(draft.widthPx, 'opening.widthPx')
    assertPositiveFinite(draft.heightMeters, 'opening.heightMeters')
    if (draft.sillHeightMeters !== undefined) {
      assertNonNegativeFinite(draft.sillHeightMeters, 'opening.sillHeightMeters')
    }

    // 非等比缩放时，每像素对应的米数随边方向变化。
    const edgeLengthMeters = distance2D(toWorld(startPx), toWorld(endPx))
    const metersPerPixel = edgeLengthMeters / pixelDistance(startPx, endPx)
    const width = draft.widthPx * metersPerPixel
    const sourceOffset = draft.offsetPx * metersPerPixel
    const edgeIndex = geometry.reversed
      ? reversedEdgeIndex(pointCount, draft.edgeIndex)
      : draft.edgeIndex
    const spanStart = geometry.reversed ? edgeLengthMeters - sourceOffset - width : sourceOffset
    const rangeIssue = (wallIds: SpatialId[]): SpatialUnresolvedIssue => ({
      id: 'issue-opening-range-' + draft.id,
      kind: 'ambiguous_opening',
      message: '开口 ' + draft.id + ' 超出匹配墙体范围',
      entityIds: [draft.id, ...wallIds],
      ...confidenceField,
      requiresHumanReview: true,
    })

    if (
      spanStart < -SPAN_TOLERANCE_METERS ||
      spanStart + width > edgeLengthMeters + SPAN_TOLERANCE_METERS
    ) {
      unresolved.push(rangeIssue([draft.roomId]))
      return undefined
    }

    const binding = bindRoomEdgeSpanToWall(
      walls,
      { id: draft.roomId, boundary: geometry.boundary },
      edgeIndex,
      Math.max(spanStart, 0),
      Math.min(spanStart + width, edgeLengthMeters),
    )

    if (binding.status === 'spans_multiple') {
      unresolved.push({
        id: 'issue-opening-span-' + draft.id,
        kind: 'ambiguous_opening',
        message:
          '开口 ' + draft.id + ' 跨越 ' + binding.wallIds.length + ' 个墙段，需要人工确认所属墙体',
        entityIds: [draft.id, ...binding.wallIds],
        ...confidenceField,
        requiresHumanReview: true,
      })
      return undefined
    }

    if (binding.status === 'outside') {
      unresolved.push(rangeIssue([draft.roomId]))
      return undefined
    }

    const wall = walls.find((candidate) => candidate.id === binding.wallId)!
    const sillHeight = draft.sillHeightMeters ?? 0

    if (sillHeight + draft.heightMeters > wall.height + 0.001) {
      unresolved.push({
        id: 'issue-opening-height-' + draft.id,
        kind: 'ambiguous_opening',
        message: '开口 ' + draft.id + ' 的垂直尺寸超过墙高，需要校正',
        entityIds: [draft.id, wall.id],
        ...confidenceField,
        requiresHumanReview: true,
      })
      return undefined
    }

    const opening: Opening = {
      id: draft.id,
      wallId: wall.id,
      kind: draft.kind,
      offset: binding.offset,
      width: binding.width,
      height: draft.heightMeters,
      ...(draft.sillHeightMeters !== undefined ? { sillHeight: draft.sillHeightMeters } : {}),
      ...(draft.swing ? { swing: draft.swing } : {}),
      provenance: {
        sourceKind: context.sourceKind,
        ...(context.sourceId ? { sourceId: context.sourceId } : {}),
        importerId: this.id,
        ...confidenceField,
      },
    }

    const lowConfidence = confidenceIssue(
      'issue-opening-confidence-' + draft.id,
      [draft.id],
      draft.confidence,
      this.confidenceThreshold,
      '开口 ' + draft.id,
    )

    if (lowConfidence) unresolved.push(lowConfidence)

    return opening
  }
}
