import { distance2D, polygonArea, type Vec2 } from './geometry'
import type {
  FloorPlanDraft,
  FloorPlanDraftOpening,
  FloorPlanDraftRoom,
  PixelPoint,
} from './floorplan-draft'
import type {
  Floor,
  HomeSpatialModel,
  Opening,
  Room,
  RoomConnection,
  RoomType,
  SpatialId,
  Wall,
} from './model'
import type {
  SpatialImportContext,
  SpatialImporter,
  SpatialImportResult,
  SpatialUnresolvedIssue,
} from './importer'
import { validateHomeSpatialModel } from './validation'

const DEFAULT_CONFIDENCE_THRESHOLD = 0.75
const QUANTIZATION = 1000

interface EdgeBinding {
  wallId: SpatialId
  reversed: boolean
  lengthMeters: number
}

interface WallBuilder {
  wall: Wall
  roomIds: Set<SpatialId>
}

export interface FloorPlanDraftImporterOptions {
  confidenceThreshold?: number
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

function assertConfidence(
  value: number | undefined,
  label: string,
) {
  if (
    value !== undefined &&
    (!Number.isFinite(value) || value < 0 || value > 1)
  ) {
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

function pixelKey(point: PixelPoint) {
  return (
    Math.round(point[0] * QUANTIZATION) +
    ',' +
    Math.round(point[1] * QUANTIZATION)
  )
}

function edgeKey(a: PixelPoint, b: PixelPoint) {
  const aKey = pixelKey(a)
  const bKey = pixelKey(b)
  return aKey < bKey ? aKey + '|' + bKey : bKey + '|' + aKey
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
      label +
      '置信度为 ' +
      confidence.toFixed(2) +
      '，低于自动确认阈值 ' +
      threshold.toFixed(2),
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

function roomType(room: FloorPlanDraftRoom): RoomType {
  return room.type ?? 'other'
}

export class FloorPlanDraftImporter
  implements SpatialImporter<FloorPlanDraft>
{
  readonly id = 'floorplan-draft-v0.1'

  private readonly confidenceThreshold: number

  constructor(options: FloorPlanDraftImporterOptions = {}) {
    this.confidenceThreshold =
      options.confidenceThreshold ?? DEFAULT_CONFIDENCE_THRESHOLD
  }

  supports(sourceKind: SpatialImportContext['sourceKind']) {
    return (
      sourceKind === 'floorplan_image' ||
      sourceKind === 'floorplan_pdf' ||
      sourceKind === 'company_data'
    )
  }

  async parse(
    input: FloorPlanDraft,
    context: SpatialImportContext,
  ): Promise<SpatialImportResult> {
    if (
      !this.supports(input.source.kind) ||
      context.sourceKind !== input.source.kind
    ) {
      throw new Error(
        'FloorPlanDraft source.kind 与 Import Context 不匹配或不受支持',
      )
    }

    assertPositiveFinite(input.source.widthPx, 'source.widthPx')
    assertPositiveFinite(input.source.heightPx, 'source.heightPx')
    assertPositiveFinite(
      input.calibration.realDistanceMeters,
      'calibration.realDistanceMeters',
    )
    assertPositiveFinite(
      input.assumptions.wallThicknessMeters,
      'assumptions.wallThicknessMeters',
    )
    assertPositiveFinite(
      input.assumptions.ceilingHeightMeters,
      'assumptions.ceilingHeightMeters',
    )

    assertPixelPointWithinSource(
      input.calibration.startPx,
      input.source.widthPx,
      input.source.heightPx,
      'calibration.startPx',
    )
    assertPixelPointWithinSource(
      input.calibration.endPx,
      input.source.widthPx,
      input.source.heightPx,
      'calibration.endPx',
    )

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
      assertConfidence(
        opening.confidence,
        'openings[' + openingIndex + '].confidence',
      )
    }

    const calibrationPx = pixelDistance(
      input.calibration.startPx,
      input.calibration.endPx,
    )

    assertPositiveFinite(calibrationPx, 'calibration pixel distance')

    const pixelsPerMeter =
      calibrationPx / input.calibration.realDistanceMeters
    const allPoints = input.rooms.flatMap((room) => room.boundaryPx)

    if (allPoints.length === 0) {
      throw new Error('FloorPlanDraft 至少需要一个房间边界')
    }

    const toRawWorld = (point: PixelPoint): Vec2 => [
      point[0] / pixelsPerMeter,
      (input.source.heightPx - point[1]) / pixelsPerMeter,
    ]

    const rawWorldPoints = allPoints.map(toRawWorld)
    const minX = Math.min(...rawWorldPoints.map((point) => point[0]))
    const minZ = Math.min(...rawWorldPoints.map((point) => point[1]))

    const toWorld = (point: PixelPoint): Vec2 => {
      const raw = toRawWorld(point)
      return [raw[0] - minX, raw[1] - minZ]
    }

    const unresolved: SpatialUnresolvedIssue[] = []
    const wallBuilders = new Map<string, WallBuilder>()
    const edgeBindings = new Map<string, EdgeBinding>()
    const rooms: Room[] = []
    let wallSequence = 1

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

      const boundary = {
        points: draftRoom.boundaryPx.map(toWorld),
      }
      const wallIds: SpatialId[] = []

      for (
        let edgeIndex = 0;
        edgeIndex < draftRoom.boundaryPx.length;
        edgeIndex += 1
      ) {
        const startPx = draftRoom.boundaryPx[edgeIndex]
        const endPx =
          draftRoom.boundaryPx[
            (edgeIndex + 1) % draftRoom.boundaryPx.length
          ]

        if (!startPx || !endPx) continue

        if (pixelDistance(startPx, endPx) <= 0.001) {
          throw new Error(
            draftRoom.name +
              ' 的边界包含零长度边，请先修正 FloorPlanDraft',
          )
        }

        const start = toWorld(startPx)
        const end = toWorld(endPx)
        const key = edgeKey(startPx, endPx)
        const existing = wallBuilders.get(key)

        if (existing) {
          existing.roomIds.add(draftRoom.id)
          wallIds.push(existing.wall.id)

          const reversed =
            distance2D(existing.wall.start, end) <
            distance2D(existing.wall.start, start)

          edgeBindings.set(draftRoom.id + ':' + edgeIndex, {
            wallId: existing.wall.id,
            reversed,
            lengthMeters: distance2D(start, end),
          })
          continue
        }

        const wallId = context.projectId + '-wall-imported-' + wallSequence
        wallSequence += 1
        const wall: Wall = {
          id: wallId,
          start,
          end,
          thickness: input.assumptions.wallThicknessMeters,
          height: input.assumptions.ceilingHeightMeters,
          provenance: {
            sourceKind: context.sourceKind,
            ...(context.sourceId ? { sourceId: context.sourceId } : {}),
            importerId: this.id,
            ...(draftRoom.confidence !== undefined
              ? { confidence: draftRoom.confidence }
              : {}),
          },
        }

        wallBuilders.set(key, {
          wall,
          roomIds: new Set([draftRoom.id]),
        })
        wallIds.push(wallId)
        edgeBindings.set(draftRoom.id + ':' + edgeIndex, {
          wallId,
          reversed: false,
          lengthMeters: distance2D(start, end),
        })
      }

      const room: Room = {
        id: draftRoom.id,
        name: draftRoom.name,
        type: roomType(draftRoom),
        boundary,
        ceilingHeight: input.assumptions.ceilingHeightMeters,
        wallIds,
        openingIds: [],
        zones: [],
        provenance: {
          sourceKind: context.sourceKind,
          ...(context.sourceId ? { sourceId: context.sourceId } : {}),
          importerId: this.id,
          ...(draftRoom.confidence !== undefined
            ? { confidence: draftRoom.confidence }
            : {}),
        },
      }

      rooms.push(room)

      if (!draftRoom.type) {
        unresolved.push({
          id: 'issue-room-type-' + draftRoom.id,
          kind: 'unknown_room_type',
          message: draftRoom.name + ' 的房间类型需要人工确认',
          entityIds: [draftRoom.id],
          ...(draftRoom.confidence !== undefined
            ? { confidence: draftRoom.confidence }
            : {}),
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

    if (!input.assumptions.wallThicknessConfirmed) {
      unresolved.push({
        id: 'issue-wall-thickness-assumption',
        kind: 'missing_dimension',
        message:
          '墙厚当前使用 ' +
          input.assumptions.wallThicknessMeters.toFixed(3) +
          'm 假设值，需要确认',
        entityIds: [...wallBuilders.values()].map(({ wall }) => wall.id),
        requiresHumanReview: true,
      })
    }

    if (!input.assumptions.ceilingHeightConfirmed) {
      unresolved.push({
        id: 'issue-ceiling-height-assumption',
        kind: 'missing_dimension',
        message:
          '层高当前使用 ' +
          input.assumptions.ceilingHeightMeters.toFixed(2) +
          'm 假设值，需要确认',
        entityIds: rooms.map((room) => room.id),
        requiresHumanReview: true,
      })
    }

    const openings: Opening[] = []
    const connections: RoomConnection[] = []
    const wallBuilderById = new Map(
      [...wallBuilders.values()].map((builder) => [builder.wall.id, builder]),
    )

    for (const draftOpening of input.openings) {
      const imported = this.importOpening(
        draftOpening,
        pixelsPerMeter,
        context,
        edgeBindings,
        wallBuilderById,
        unresolved,
      )

      if (!imported) continue

      openings.push(imported)

      for (const room of rooms) {
        if (room.wallIds.includes(imported.wallId)) {
          room.openingIds.push(imported.id)
        }
      }

      const connectedRoomIds = wallBuilderById.get(imported.wallId)
        ? [...wallBuilderById.get(imported.wallId)!.roomIds]
        : []

      if (
        (imported.kind === 'door' || imported.kind === 'opening') &&
        connectedRoomIds.length === 2
      ) {
        const fromRoomId = connectedRoomIds[0]
        const toRoomId = connectedRoomIds[1]

        if (fromRoomId && toRoomId) {
          connections.push({
            id: context.projectId + '-connection-' + imported.id,
            fromRoomId,
            toRoomId,
            kind: imported.kind === 'door' ? 'door' : 'opening',
            openingId: imported.id,
            provenance: {
              sourceKind: context.sourceKind,
              ...(context.sourceId ? { sourceId: context.sourceId } : {}),
              importerId: this.id,
              ...(imported.provenance?.confidence !== undefined
                ? { confidence: imported.provenance.confidence }
                : {}),
            },
          })
        }
      } else if (connectedRoomIds.length > 2) {
        unresolved.push({
          id: 'issue-opening-topology-' + imported.id,
          kind: 'topology_conflict',
          message: '开口 ' + imported.id + ' 所在墙体连接超过两个房间',
          entityIds: [imported.id, ...connectedRoomIds],
          requiresHumanReview: true,
        })
      }
    }

    for (const [key, builder] of wallBuilders) {
      if (builder.roomIds.size > 2) {
        unresolved.push({
          id: 'issue-wall-topology-' + key.replace(/[^a-zA-Z0-9]+/g, '-'),
          kind: 'topology_conflict',
          message: '同一墙段被超过两个房间共享，需要人工检查拓扑',
          entityIds: [builder.wall.id, ...builder.roomIds],
          requiresHumanReview: true,
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
      walls: [...wallBuilders.values()].map(({ wall }) => wall),
      openings,
      structuralElements: [],
      utilityAnchors: [],
      connections,
      provenance: {
        sourceKind: context.sourceKind,
        ...(context.sourceId ? { sourceId: context.sourceId } : {}),
        importerId: this.id,
        ...(overallConfidence !== undefined
          ? { confidence: overallConfidence }
          : {}),
      },
    }

    const model: HomeSpatialModel = {
      schemaVersion: '0.2.0',
      id: context.projectId + '-spatial',
      name: context.projectName,
      unit: 'meter',
      coordinateSystem: 'right-handed-y-up',
      floors: [floor],
      provenance: {
        sourceKind: context.sourceKind,
        ...(context.sourceId ? { sourceId: context.sourceId } : {}),
        importerId: this.id,
        ...(overallConfidence !== undefined
          ? { confidence: overallConfidence }
          : {}),
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
    pixelsPerMeter: number,
    context: SpatialImportContext,
    edgeBindings: Map<string, EdgeBinding>,
    wallBuilderById: Map<SpatialId, WallBuilder>,
    unresolved: SpatialUnresolvedIssue[],
  ) {
    const binding = edgeBindings.get(draft.roomId + ':' + draft.edgeIndex)

    if (!binding) {
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
        ...(draft.confidence !== undefined
          ? { confidence: draft.confidence }
          : {}),
        requiresHumanReview: true,
      })
      return undefined
    }

    assertNonNegativeFinite(draft.offsetPx, 'opening.offsetPx')
    assertPositiveFinite(draft.widthPx, 'opening.widthPx')
    assertPositiveFinite(draft.heightMeters, 'opening.heightMeters')
    if (draft.sillHeightMeters !== undefined) {
      assertNonNegativeFinite(
        draft.sillHeightMeters,
        'opening.sillHeightMeters',
      )
    }

    const width = draft.widthPx / pixelsPerMeter
    const sourceOffset = draft.offsetPx / pixelsPerMeter
    const offset = binding.reversed
      ? binding.lengthMeters - sourceOffset - width
      : sourceOffset
    const wall = wallBuilderById.get(binding.wallId)?.wall
    const sillHeight = draft.sillHeightMeters ?? 0

    if (
      !wall ||
      !Number.isFinite(offset) ||
      offset < 0 ||
      offset + width > binding.lengthMeters + 0.001
    ) {
      unresolved.push({
        id: 'issue-opening-range-' + draft.id,
        kind: 'ambiguous_opening',
        message: '开口 ' + draft.id + ' 超出匹配墙体范围',
        entityIds: [draft.id, binding.wallId],
        ...(draft.confidence !== undefined
          ? { confidence: draft.confidence }
          : {}),
        requiresHumanReview: true,
      })
      return undefined
    }

    if (sillHeight + draft.heightMeters > wall.height + 0.001) {
      unresolved.push({
        id: 'issue-opening-height-' + draft.id,
        kind: 'ambiguous_opening',
        message: '开口 ' + draft.id + ' 的垂直尺寸超过墙高，需要校正',
        entityIds: [draft.id, binding.wallId],
        ...(draft.confidence !== undefined
          ? { confidence: draft.confidence }
          : {}),
        requiresHumanReview: true,
      })
      return undefined
    }

    const opening: Opening = {
      id: draft.id,
      wallId: binding.wallId,
      kind: draft.kind,
      offset,
      width,
      height: draft.heightMeters,
      ...(draft.sillHeightMeters !== undefined
        ? { sillHeight: draft.sillHeightMeters }
        : {}),
      ...(draft.swing ? { swing: draft.swing } : {}),
      provenance: {
        sourceKind: context.sourceKind,
        ...(context.sourceId ? { sourceId: context.sourceId } : {}),
        importerId: this.id,
        ...(draft.confidence !== undefined
          ? { confidence: draft.confidence }
          : {}),
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
