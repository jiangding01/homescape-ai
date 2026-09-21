import type {
  CatalogAsset,
  CatalogQuery,
  CatalogRepository,
  CatalogVariant,
  PlacementAnchor,
} from '@homescape/catalog'
import type {
  DesignObject,
  DesignOperation,
  DesignScope,
  DesignState,
  ResolvedDesignMutation,
} from '@homescape/domain'
import {
  distance2D,
  polygonBounds,
  polygonCenter,
  type Floor,
  type HomeSpatialModel,
  type Polygon2D,
  type Room,
  type Vec2,
  type Vec3,
  type Wall,
  type Zone,
} from '@homescape/spatial-model'
import {
  expandFootprint,
  footprintInsidePolygon,
  footprintsOverlap,
  type Footprint2D,
} from './geometry'
import type {
  ConstraintViolation,
  PlannerDecision,
  PlannerInput,
  PlannerResult,
  SpatialPlanner,
} from './types'

interface PlacementRegion {
  floor: Floor
  room: Room
  boundary: Polygon2D
  zone?: Zone
}

interface PlacementCandidate {
  asset: CatalogAsset
  variant?: CatalogVariant
  position: Vec3
  yaw: number
  anchor: PlacementAnchor
  score: number
}

interface PlannerWorkingState {
  objects: DesignObject[]
  locks: Set<string>
  preserved: Set<string>
}

function numberRequirement(
  requirements: Readonly<Record<string, unknown>>,
  key: string,
) {
  const value = requirements[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function stringRequirement(
  requirements: Readonly<Record<string, unknown>>,
  key: string,
) {
  const value = requirements[key]
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function stringArrayRequirement(
  requirements: Readonly<Record<string, unknown>>,
  key: string,
) {
  const value = requirements[key]

  if (!Array.isArray(value)) return undefined

  const strings = value.filter(
    (item): item is string => typeof item === 'string' && Boolean(item.trim()),
  )

  return strings.length > 0 ? strings : undefined
}

function requirementsToQuery(
  category: string,
  requirements: Readonly<Record<string, unknown>>,
): CatalogQuery {
  const minWidth = numberRequirement(requirements, 'minWidth')
  const maxWidth = numberRequirement(requirements, 'maxWidth')
  const maxDepth = numberRequirement(requirements, 'maxDepth')
  const maxPrice = numberRequirement(requirements, 'maxPrice')
  const minSeats = numberRequirement(requirements, 'minSeats')
  const colorFamily = stringRequirement(requirements, 'colorFamily')
  const style = stringRequirement(requirements, 'style')
  const styleTags = stringArrayRequirement(requirements, 'styleTags') ?? (style ? [style] : undefined)

  return {
    category,
    ...(minWidth !== undefined ? { minWidth } : {}),
    ...(maxWidth !== undefined ? { maxWidth } : {}),
    ...(maxDepth !== undefined ? { maxDepth } : {}),
    ...(maxPrice !== undefined ? { maxPrice } : {}),
    ...(minSeats !== undefined ? { minSeats } : {}),
    ...(colorFamily ? { colorFamily } : {}),
    ...(styleTags ? { styleTags } : {}),
  }
}

function resolveVariant(
  asset: CatalogAsset,
  requirements: Readonly<Record<string, unknown>>,
) {
  const colorFamily = stringRequirement(requirements, 'colorFamily')

  if (colorFamily) {
    return asset.variants?.find((variant) => variant.colorFamily === colorFamily)
  }

  return asset.variants?.[0]
}

function objectFootprint(object: DesignObject): Footprint2D {
  const dimensions = object.dimensions ?? ([0.72, 0.72, 0.72] as const)

  return {
    center: [object.transform.position[0], object.transform.position[2]],
    width: dimensions[0],
    depth: dimensions[2],
    yaw: object.transform.yaw,
  }
}

function wallPoint(wall: Wall, distance: number): Vec2 {
  const length = distance2D(wall.start, wall.end)

  if (length === 0) return wall.start

  const ratio = distance / length

  return [
    wall.start[0] + (wall.end[0] - wall.start[0]) * ratio,
    wall.start[1] + (wall.end[1] - wall.start[1]) * ratio,
  ]
}

function openingClearanceFootprints(region: PlacementRegion): Footprint2D[] {
  const wallMap = new Map(region.floor.walls.map((wall) => [wall.id, wall]))
  const openingMap = new Map(region.floor.openings.map((opening) => [opening.id, opening]))
  const footprints: Footprint2D[] = []

  for (const openingId of region.room.openingIds) {
    const opening = openingMap.get(openingId)

    if (!opening || (opening.kind !== 'door' && opening.kind !== 'opening')) continue

    const wall = wallMap.get(opening.wallId)

    if (!wall) continue

    const length = distance2D(wall.start, wall.end)

    if (length <= 0.001) continue

    const center = wallPoint(wall, opening.offset + opening.width / 2)
    const dx = wall.end[0] - wall.start[0]
    const dz = wall.end[1] - wall.start[1]

    footprints.push({
      center,
      width: opening.width + 0.3,
      depth: 1,
      yaw: -Math.atan2(dz, dx),
    })
  }

  return footprints
}

function columnFootprints(region: PlacementRegion): Footprint2D[] {
  return region.floor.structuralElements
    .filter((element) => element.kind === 'column')
    .map((column) => ({
      center: column.center,
      width: column.size[0],
      depth: column.size[1],
      yaw: column.rotation,
    }))
}

function regionForScope(
  spatialModel: HomeSpatialModel,
  state: DesignState,
  scope: DesignScope,
): PlacementRegion | undefined {
  if (scope.type === 'room') {
    for (const floor of spatialModel.floors) {
      const room = floor.rooms.find((candidate) => candidate.id === scope.roomId)
      if (room) return { floor, room, boundary: room.boundary }
    }

    return undefined
  }

  if (scope.type === 'zone') {
    for (const floor of spatialModel.floors) {
      for (const room of floor.rooms) {
        const zone = room.zones.find((candidate) => candidate.id === scope.zoneId)
        if (zone) return { floor, room, zone, boundary: zone.boundary }
      }
    }

    return undefined
  }

  if (scope.type === 'object') {
    const object = state.objects[scope.objectId]

    if (!object?.roomId) return undefined

    for (const floor of spatialModel.floors) {
      const room = floor.rooms.find((candidate) => candidate.id === object.roomId)
      if (!room) continue

      if (object.zoneId) {
        const zone = room.zones.find((candidate) => candidate.id === object.zoneId)
        if (zone) return { floor, room, zone, boundary: zone.boundary }
      }

      return { floor, room, boundary: room.boundary }
    }
  }

  return undefined
}

function candidateFootprint(candidate: PlacementCandidate) {
  return {
    center: [candidate.position[0], candidate.position[2]] as Vec2,
    width: candidate.asset.dimensions.width,
    depth: candidate.asset.dimensions.depth,
    yaw: candidate.yaw,
  }
}

function candidateIsValid(
  candidate: PlacementCandidate,
  region: PlacementRegion,
  workingObjects: readonly DesignObject[],
  excludeObjectId?: string,
) {
  const baseFootprint = candidateFootprint(candidate)
  const padded = expandFootprint(
    baseFootprint,
    candidate.asset.placement.collisionPadding,
  )

  if (!footprintInsidePolygon(padded, region.boundary)) return false

  for (const object of workingObjects) {
    if (object.id === excludeObjectId) continue

    const existing = expandFootprint(objectFootprint(object), 0.04)
    if (footprintsOverlap(padded, existing)) return false
  }

  for (const structure of columnFootprints(region)) {
    if (footprintsOverlap(padded, structure)) return false
  }

  for (const opening of openingClearanceFootprints(region)) {
    if (footprintsOverlap(padded, opening)) return false
  }

  return true
}

function generateWallCandidates(
  asset: CatalogAsset,
  region: PlacementRegion,
  variant: CatalogVariant | undefined,
) {
  const wallMap = new Map(region.floor.walls.map((wall) => [wall.id, wall]))
  const candidates: PlacementCandidate[] = []
  const roomCenter = polygonCenter(region.boundary)

  for (const wallId of region.room.wallIds) {
    const wall = wallMap.get(wallId)

    if (!wall) continue

    const length = distance2D(wall.start, wall.end)
    const requiredLength = asset.dimensions.width + asset.placement.wallClearance * 2

    if (length < requiredLength) continue

    const dx = wall.end[0] - wall.start[0]
    const dz = wall.end[1] - wall.start[1]
    const unitX = dx / length
    const unitZ = dz / length
    const normals: readonly Vec2[] = [
      [-unitZ, unitX],
      [unitZ, -unitX],
    ]
    const fractions = [0.25, 0.5, 0.75] as const

    for (const fraction of fractions) {
      const centerOnWall: Vec2 = [
        wall.start[0] + dx * fraction,
        wall.start[1] + dz * fraction,
      ]

      for (const normal of normals) {
        const inset =
          asset.dimensions.depth / 2 + asset.placement.wallClearance
        const center: Vec2 = [
          centerOnWall[0] + normal[0] * inset,
          centerOnWall[1] + normal[1] * inset,
        ]
        const score =
          120 +
          Math.min(length, 8) * 2 -
          distance2D(center, roomCenter) * 1.5

        candidates.push({
          asset,
          ...(variant ? { variant } : {}),
          position: [center[0], region.floor.elevation, center[1]],
          yaw: -Math.atan2(dz, dx),
          anchor: 'wall',
          score,
        })
      }
    }
  }

  return candidates
}

function generateCenterCandidates(
  asset: CatalogAsset,
  region: PlacementRegion,
  variant: CatalogVariant | undefined,
) {
  const center = polygonCenter(region.boundary)
  const bounds = polygonBounds(region.boundary)
  const offsets: readonly Vec2[] = [
    [0, 0],
    [bounds.width * 0.12, 0],
    [-bounds.width * 0.12, 0],
    [0, bounds.depth * 0.12],
    [0, -bounds.depth * 0.12],
  ]

  return offsets.map((offset, index): PlacementCandidate => ({
    asset,
    ...(variant ? { variant } : {}),
    position: [
      center[0] + offset[0],
      region.floor.elevation,
      center[1] + offset[1],
    ],
    yaw: 0,
    anchor: 'center',
    score: 105 - index * 3,
  }))
}

function generateFreeCandidates(
  asset: CatalogAsset,
  region: PlacementRegion,
  variant: CatalogVariant | undefined,
) {
  const bounds = polygonBounds(region.boundary)
  const marginX = asset.dimensions.width / 2 + 0.2
  const marginZ = asset.dimensions.depth / 2 + 0.2
  const minX = bounds.min[0] + marginX
  const maxX = bounds.max[0] - marginX
  const minZ = bounds.min[1] + marginZ
  const maxZ = bounds.max[1] - marginZ

  if (minX > maxX || minZ > maxZ) return [] as PlacementCandidate[]

  const points: readonly Vec2[] = [
    [minX, minZ],
    [maxX, minZ],
    [maxX, maxZ],
    [minX, maxZ],
    [(minX + maxX) / 2, minZ],
    [maxX, (minZ + maxZ) / 2],
    [(minX + maxX) / 2, maxZ],
    [minX, (minZ + maxZ) / 2],
  ]

  const roomCenter = polygonCenter(region.boundary)

  return points.map((point, index): PlacementCandidate => ({
    asset,
    ...(variant ? { variant } : {}),
    position: [point[0], region.floor.elevation, point[1]],
    yaw: 0,
    anchor: 'free',
    score: 88 - distance2D(point, roomCenter) * 0.4 - index * 0.1,
  }))
}

function generateCandidates(
  asset: CatalogAsset,
  region: PlacementRegion,
  requirements: Readonly<Record<string, unknown>>,
) {
  const variant = resolveVariant(asset, requirements)
  const candidates: PlacementCandidate[] = []

  for (const anchor of asset.placement.anchors) {
    if (anchor === 'wall') {
      candidates.push(...generateWallCandidates(asset, region, variant))
    } else if (anchor === 'center') {
      candidates.push(...generateCenterCandidates(asset, region, variant))
    } else {
      candidates.push(...generateFreeCandidates(asset, region, variant))
    }
  }

  return candidates
}

function createDesignObject(
  objectId: string,
  category: string,
  candidate: PlacementCandidate,
  region: PlacementRegion,
): DesignObject {
  const metadata: Record<string, string | number | boolean> = {
    sku: candidate.asset.sku,
    catalogName: candidate.asset.name,
  }

  if (candidate.asset.price !== undefined) metadata.price = candidate.asset.price
  if (candidate.variant?.colorFamily) metadata.colorFamily = candidate.variant.colorFamily

  return {
    id: objectId,
    assetId: candidate.asset.id,
    category,
    transform: {
      position: candidate.position,
      yaw: candidate.yaw,
    },
    roomId: region.room.id,
    ...(region.zone ? { zoneId: region.zone.id } : {}),
    dimensions: [
      candidate.asset.dimensions.width,
      candidate.asset.dimensions.height,
      candidate.asset.dimensions.depth,
    ],
    ...(candidate.variant ? { variantId: candidate.variant.id } : {}),
    metadata,
    provenance: {
      source: 'planner',
    },
  }
}

function protectedViolation(
  operation: DesignOperation,
  targetId: string,
): ConstraintViolation {
  return {
    code: 'planner.target_protected',
    severity: 'error',
    message: '目标被 Lock 或 Preserve 保护，Planner 不会修改：' + targetId,
    operationId: operation.id,
    objectIds: [targetId],
  }
}

export class RuleBasedPlanner implements SpatialPlanner {
  constructor(private readonly catalog: CatalogRepository) {}

  async plan(input: PlannerInput): Promise<PlannerResult> {
    const startedAt = Date.now()
    const mutations: ResolvedDesignMutation[] = []
    const violations: ConstraintViolation[] = []
    const decisions: PlannerDecision[] = []
    const working: PlannerWorkingState = {
      objects: Object.values(input.state.objects).map((object) => ({
        ...object,
        transform: {
          position: [...object.transform.position] as Vec3,
          yaw: object.transform.yaw,
        },
      })),
      locks: new Set(Object.keys(input.state.locks)),
      preserved: new Set(
        input.operations
          .filter((operation) => operation.type === 'preserve')
          .map((operation) => operation.targetId),
      ),
    }
    let candidateCount = 0
    let rejectedCandidateCount = 0

    const isProtected = (targetId: string) =>
      working.locks.has(targetId) || working.preserved.has(targetId)

    const findWorkingObject = (objectId: string) =>
      working.objects.find((object) => object.id === objectId)

    for (const operation of input.operations) {
      if (operation.type === 'preserve') {
        decisions.push({
          operationId: operation.id,
          action: 'preserve',
          candidateCount: 0,
        })
        continue
      }

      if (operation.type === 'lock' || operation.type === 'unlock') {
        const locked = operation.type === 'lock'

        mutations.push({
          type: 'set_lock',
          targetId: operation.targetId,
          locked,
          lockedBy: 'user',
        })

        if (locked) working.locks.add(operation.targetId)
        else working.locks.delete(operation.targetId)

        decisions.push({
          operationId: operation.id,
          action: locked ? 'lock' : 'unlock',
          candidateCount: 0,
        })
        continue
      }

      if (operation.type === 'add_object') {
        const region = regionForScope(input.spatialModel, input.state, operation.scope)

        if (!region) {
          violations.push({
            code: 'planner.scope_not_placeable',
            severity: 'error',
            message: '新增家具需要 Room 或 Zone 级作用域',
            operationId: operation.id,
          })
          continue
        }

        const query = requirementsToQuery(operation.category, operation.requirements)
        const assets = await this.catalog.search(query)
        let best: PlacementCandidate | undefined
        let validCandidates = 0

        for (const asset of assets) {
          const generated = generateCandidates(asset, region, operation.requirements)
          candidateCount += generated.length

          for (const candidate of generated) {
            if (!candidateIsValid(candidate, region, working.objects)) {
              rejectedCandidateCount += 1
              continue
            }

            validCandidates += 1

            if (!best || candidate.score > best.score) best = candidate
          }
        }

        if (!best) {
          violations.push({
            code: 'planner.no_feasible_candidate',
            severity: 'error',
            message:
              assets.length === 0
                ? 'Catalog 中没有满足需求的 ' + operation.category
                : '找到商品，但当前空间没有可行摆放位置：' + operation.category,
            operationId: operation.id,
          })
          continue
        }

        const objectId = 'object-' + operation.id
        const object = createDesignObject(
          objectId,
          operation.category,
          best,
          region,
        )

        mutations.push({
          type: 'upsert_object',
          object,
        })
        working.objects.push(object)
        decisions.push({
          operationId: operation.id,
          action: 'add_object',
          candidateCount: validCandidates,
          selectedAssetId: best.asset.id,
          ...(best.variant ? { selectedVariantId: best.variant.id } : {}),
          roomId: region.room.id,
          anchor: best.anchor,
          score: best.score,
        })
        continue
      }

      if (operation.type === 'replace_object') {
        const existing = findWorkingObject(operation.objectId)

        if (!existing) {
          violations.push({
            code: 'planner.object_missing',
            severity: 'error',
            message: '无法替换不存在的对象：' + operation.objectId,
            operationId: operation.id,
            objectIds: [operation.objectId],
          })
          continue
        }

        if (isProtected(existing.id)) {
          violations.push(protectedViolation(operation, existing.id))
          continue
        }

        const region = regionForScope(
          input.spatialModel,
          input.state,
          { type: 'object', objectId: existing.id },
        )

        if (!region) {
          violations.push({
            code: 'planner.object_scope_missing',
            severity: 'error',
            message: '对象缺少可解析的 Room / Zone：' + existing.id,
            operationId: operation.id,
            objectIds: [existing.id],
          })
          continue
        }

        const query = requirementsToQuery(existing.category, operation.requirements)
        const assets = await this.catalog.search(query)
        let best: PlacementCandidate | undefined
        let validCandidates = 0

        for (const asset of assets) {
          const variant = resolveVariant(asset, operation.requirements)
          const keepTransform: PlacementCandidate = {
            asset,
            ...(variant ? { variant } : {}),
            position: existing.transform.position,
            yaw: existing.transform.yaw,
            anchor: 'free',
            score: 150,
          }
          const generated = [
            keepTransform,
            ...generateCandidates(asset, region, operation.requirements),
          ]

          candidateCount += generated.length

          for (const candidate of generated) {
            if (
              !candidateIsValid(
                candidate,
                region,
                working.objects,
                existing.id,
              )
            ) {
              rejectedCandidateCount += 1
              continue
            }

            validCandidates += 1

            if (!best || candidate.score > best.score) best = candidate
          }
        }

        if (!best) {
          violations.push({
            code: 'planner.no_feasible_replacement',
            severity: 'error',
            message:
              assets.length === 0
                ? 'Catalog 中没有满足替换条件的 ' + existing.category
                : '替换商品存在，但没有满足空间约束的位置',
            operationId: operation.id,
            objectIds: [existing.id],
          })
          continue
        }

        const object = createDesignObject(
          existing.id,
          existing.category,
          best,
          region,
        )

        mutations.push({
          type: 'upsert_object',
          object,
        })

        const workingIndex = working.objects.findIndex(
          (candidate) => candidate.id === existing.id,
        )
        if (workingIndex >= 0) working.objects[workingIndex] = object

        decisions.push({
          operationId: operation.id,
          action: 'replace_object',
          candidateCount: validCandidates,
          selectedAssetId: best.asset.id,
          ...(best.variant ? { selectedVariantId: best.variant.id } : {}),
          roomId: region.room.id,
          anchor: best.anchor,
          score: best.score,
        })
        continue
      }

      if (
        operation.type === 'remove_object' ||
        operation.type === 'move_object' ||
        operation.type === 'rotate_object'
      ) {
        const existing = findWorkingObject(operation.objectId)

        if (!existing) {
          violations.push({
            code: 'planner.object_missing',
            severity: 'error',
            message: '对象不存在：' + operation.objectId,
            operationId: operation.id,
            objectIds: [operation.objectId],
          })
          continue
        }

        if (isProtected(existing.id)) {
          violations.push(protectedViolation(operation, existing.id))
          continue
        }

        if (operation.type === 'remove_object') {
          mutations.push({
            type: 'remove_object',
            objectId: existing.id,
          })
          working.objects = working.objects.filter(
            (candidate) => candidate.id !== existing.id,
          )
          decisions.push({
            operationId: operation.id,
            action: 'remove_object',
            candidateCount: 0,
          })
          continue
        }

        const region = regionForScope(
          input.spatialModel,
          input.state,
          { type: 'object', objectId: existing.id },
        )

        if (!region) {
          violations.push({
            code: 'planner.object_scope_missing',
            severity: 'error',
            message: '对象缺少可解析的 Room / Zone：' + existing.id,
            operationId: operation.id,
            objectIds: [existing.id],
          })
          continue
        }

        const dimensions = existing.dimensions ?? ([0.72, 0.72, 0.72] as const)
        const candidate: PlacementCandidate = {
          asset: {
            id: existing.assetId,
            sku: existing.assetId,
            name: existing.assetId,
            category: existing.category,
            dimensions: {
              width: dimensions[0],
              height: dimensions[1],
              depth: dimensions[2],
            },
            placement: {
              anchors: ['free'],
              wallClearance: 0,
              collisionPadding: 0.04,
              allowRotation: true,
            },
            tags: [],
            active: true,
          },
          position:
            operation.type === 'move_object'
              ? operation.position
              : existing.transform.position,
          yaw:
            operation.type === 'rotate_object'
              ? operation.yaw
              : existing.transform.yaw,
          anchor: 'free',
          score: 0,
        }

        candidateCount += 1

        if (
          !candidateIsValid(
            candidate,
            region,
            working.objects,
            existing.id,
          )
        ) {
          rejectedCandidateCount += 1
          violations.push({
            code: 'planner.manual_transform_invalid',
            severity: 'error',
            message: '目标位置违反房间边界、碰撞或门洞净空约束',
            operationId: operation.id,
            objectIds: [existing.id],
          })
          continue
        }

        if (operation.type === 'move_object') {
          mutations.push({
            type: 'move_object',
            objectId: existing.id,
            position: operation.position,
          })
          existing.transform = {
            ...existing.transform,
            position: operation.position,
          }
        } else {
          mutations.push({
            type: 'rotate_object',
            objectId: existing.id,
            yaw: operation.yaw,
          })
          existing.transform = {
            ...existing.transform,
            yaw: operation.yaw,
          }
        }

        decisions.push({
          operationId: operation.id,
          action: operation.type,
          candidateCount: 1,
          roomId: region.room.id,
        })
        continue
      }

      if (operation.type === 'set_material') {
        if (isProtected(operation.targetId)) {
          violations.push(protectedViolation(operation, operation.targetId))
          continue
        }

        mutations.push({
          type: 'set_material',
          targetId: operation.targetId,
          material: operation.material,
          provenance: { source: operation.source },
        })
        decisions.push({
          operationId: operation.id,
          action: 'set_material',
          candidateCount: 0,
        })
        continue
      }

      if (operation.type === 'set_style_intent') {
        if (isProtected(operation.targetId)) {
          violations.push(protectedViolation(operation, operation.targetId))
          continue
        }

        mutations.push({
          type: 'set_style_intent',
          targetId: operation.targetId,
          style: operation.style,
          provenance: { source: operation.source },
        })
        decisions.push({
          operationId: operation.id,
          action: 'set_style_intent',
          candidateCount: 0,
        })
      }
    }

    return {
      mutations,
      violations,
      decisions,
      diagnostics: {
        candidateCount,
        rejectedCandidateCount,
        elapsedMs: Date.now() - startedAt,
      },
    }
  }
}
