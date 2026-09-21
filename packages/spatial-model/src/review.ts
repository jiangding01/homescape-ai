import type { HomeSpatialModel, RoomType, SpatialId } from './model'
import type {
  SpatialImportResult,
  SpatialUnresolvedIssue,
} from './importer'
import { validateHomeSpatialModel } from './validation'

export interface SpatialReviewResolution {
  issueId: string
  resolvedAt: string
  note?: string
}

export interface SpatialReviewSession {
  model: HomeSpatialModel
  unresolved: SpatialUnresolvedIssue[]
  resolutions: Record<string, SpatialReviewResolution>
}

export type SpatialCorrection =
  | {
      type: 'set_room_type'
      roomId: SpatialId
      roomType: RoomType
      issueIds?: string[]
    }
  | {
      type: 'set_room_ceiling_height'
      roomId: SpatialId
      heightMeters: number
      issueIds?: string[]
    }
  | {
      type: 'set_wall_thickness'
      wallIds: SpatialId[]
      thicknessMeters: number
      issueIds?: string[]
    }
  | {
      type: 'resolve_issue'
      issueId: string
      note?: string
    }

function cloneModel(model: HomeSpatialModel): HomeSpatialModel {
  return {
    ...model,
    floors: model.floors.map((floor) => ({
      ...floor,
      rooms: floor.rooms.map((room) => ({
        ...room,
        boundary: {
          points: room.boundary.points.map((point) => [...point] as typeof point),
        },
        wallIds: [...room.wallIds],
        openingIds: [...room.openingIds],
        zones: room.zones.map((zone) => ({
          ...zone,
          boundary: {
            points: zone.boundary.points.map(
              (point) => [...point] as typeof point,
            ),
          },
        })),
      })),
      walls: floor.walls.map((wall) => ({
        ...wall,
        start: [...wall.start] as typeof wall.start,
        end: [...wall.end] as typeof wall.end,
      })),
      openings: floor.openings.map((opening) => ({ ...opening })),
      structuralElements: floor.structuralElements.map((element) => ({
        ...element,
      })),
      utilityAnchors: floor.utilityAnchors.map((anchor) => ({
        ...anchor,
        position: [...anchor.position] as typeof anchor.position,
      })),
      connections: floor.connections.map((connection) => ({
        ...connection,
      })),
    })),
  }
}

function ensurePositive(value: number, label: string) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(label + ' 必须为正数')
  }
}

function resolution(
  issueId: string,
  note?: string,
): SpatialReviewResolution {
  return {
    issueId,
    resolvedAt: new Date().toISOString(),
    ...(note ? { note } : {}),
  }
}

export function createSpatialReviewSession(
  result: SpatialImportResult,
): SpatialReviewSession {
  return {
    model: cloneModel(result.model),
    unresolved: result.unresolved.map((issue) => ({ ...issue })),
    resolutions: {},
  }
}

export function applySpatialCorrection(
  session: SpatialReviewSession,
  correction: SpatialCorrection,
): SpatialReviewSession {
  const model = cloneModel(session.model)
  const resolutions = { ...session.resolutions }

  if (correction.type === 'set_room_type') {
    let found = false

    for (const floor of model.floors) {
      const room = floor.rooms.find(
        (candidate) => candidate.id === correction.roomId,
      )

      if (!room) continue

      room.type = correction.roomType
      found = true
      break
    }

    if (!found) {
      throw new Error('找不到房间：' + correction.roomId)
    }
  } else if (correction.type === 'set_room_ceiling_height') {
    ensurePositive(correction.heightMeters, '层高')
    let found = false

    for (const floor of model.floors) {
      const room = floor.rooms.find(
        (candidate) => candidate.id === correction.roomId,
      )

      if (!room) continue

      room.ceilingHeight = correction.heightMeters
      found = true
      break
    }

    if (!found) {
      throw new Error('找不到房间：' + correction.roomId)
    }
  } else if (correction.type === 'set_wall_thickness') {
    ensurePositive(correction.thicknessMeters, '墙厚')
    const targetIds = new Set(correction.wallIds)
    let updated = 0

    for (const floor of model.floors) {
      for (const wall of floor.walls) {
        if (!targetIds.has(wall.id)) continue

        wall.thickness = correction.thicknessMeters
        updated += 1
      }
    }

    if (updated !== targetIds.size) {
      throw new Error('部分墙体不存在，不能完成墙厚校正')
    }
  }

  const issueIds =
    correction.type === 'resolve_issue'
      ? [correction.issueId]
      : correction.issueIds ?? []

  for (const issueId of issueIds) {
    const issue = session.unresolved.find(
      (candidate) => candidate.id === issueId,
    )

    if (!issue) {
      throw new Error('找不到待确认问题：' + issueId)
    }

    resolutions[issueId] = resolution(
      issueId,
      correction.type === 'resolve_issue' ? correction.note : undefined,
    )
  }

  return {
    model,
    unresolved: session.unresolved,
    resolutions,
  }
}

export function getPendingSpatialReviewIssues(
  session: SpatialReviewSession,
) {
  return session.unresolved.filter(
    (issue) =>
      issue.requiresHumanReview && !session.resolutions[issue.id],
  )
}

export function canFinalizeSpatialReview(
  session: SpatialReviewSession,
) {
  return (
    getPendingSpatialReviewIssues(session).length === 0 &&
    validateHomeSpatialModel(session.model).valid
  )
}

export function finalizeSpatialReview(
  session: SpatialReviewSession,
) {
  const validation = validateHomeSpatialModel(session.model)
  const pending = getPendingSpatialReviewIssues(session)

  if (!validation.valid) {
    throw new Error(
      '空间模型仍存在校验错误：' +
        validation.issues
          .filter((issue) => issue.severity === 'error')
          .map((issue) => issue.message)
          .join('；'),
    )
  }

  if (pending.length > 0) {
    throw new Error(
      '仍有 ' + pending.length + ' 个问题需要人工确认',
    )
  }

  return cloneModel(session.model)
}
