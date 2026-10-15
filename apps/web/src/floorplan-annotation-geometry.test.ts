import type { FloorPlanDraftOpening, PixelPoint } from '@homescape/spatial-model'
import { describe, expect, it } from 'vitest'
import {
  fullViewport,
  nearestEdgeProjection,
  nextEntityId,
  planOpeningFromClicks,
  projectPointToEdge,
  screenToSource,
  viewportScreenScale,
} from './floorplan-annotation-geometry'

// 200 x 100 rectangle: edge0 top, edge1 right, edge2 bottom (right to left), edge3 left.
const rect: PixelPoint[] = [[0, 0], [200, 0], [200, 100], [0, 100]]
const room = { id: 'r1', boundaryPx: rect }

const opening = (partial: Partial<FloorPlanDraftOpening>): FloorPlanDraftOpening => ({
  id: 'o1',
  roomId: 'r1',
  edgeIndex: 0,
  kind: 'door',
  offsetPx: 0,
  widthPx: 10,
  heightMeters: 2.1,
  ...partial,
})

describe('viewportScreenScale / screenToSource', () => {
  it('uses the limiting axis (preserveAspectRatio meet)', () => {
    expect(viewportScreenScale(500, 500, fullViewport(1000, 500))).toBe(0.5)
    expect(viewportScreenScale(800, 200, fullViewport(1000, 500))).toBe(0.4)
  })

  it('grows when zoomed in', () => {
    expect(viewportScreenScale(500, 250, { x: 0, y: 0, width: 250, height: 125 })).toBe(2)
  })

  it('is null before the canvas is laid out', () => {
    expect(viewportScreenScale(0, 0, fullViewport(1000, 500))).toBeNull()
  })

  it('keeps a handle a constant number of screen pixels', () => {
    // A 4000px wide plan shown 500 screen px wide: an 8 screen-px radius is 64 source px.
    expect(screenToSource(8, 0.125)).toBe(64)
    expect(screenToSource(8, 2)).toBe(4)
    expect(screenToSource(8, 0)).toBe(8)
    expect(screenToSource(8, NaN)).toBe(8)
  })
})

describe('projectPointToEdge / nearestEdgeProjection', () => {
  it('projects onto the edge and reports the distance', () => {
    const result = projectPointToEdge(rect, 0, [50, 7])!
    expect(result.point).toEqual([50, 0])
    expect(result.alongPx).toBe(50)
    expect(result.distancePx).toBe(7)
    expect(result.edgeLengthPx).toBe(200)
  })

  it('clamps beyond the corners', () => {
    expect(projectPointToEdge(rect, 0, [-30, 0])!.alongPx).toBe(0)
    expect(projectPointToEdge(rect, 0, [260, 0])!.alongPx).toBe(200)
  })

  it('wraps the closing edge and rejects invalid ones', () => {
    expect(projectPointToEdge(rect, 3, [4, 40])!.point).toEqual([0, 40])
    expect(projectPointToEdge(rect, 4, [0, 0])).toBeNull()
    expect(projectPointToEdge([[1, 1], [1, 1], [5, 5]], 0, [0, 0])).toBeNull()
  })

  it('picks the closest edge within the limit', () => {
    expect(nearestEdgeProjection(rect, [100, 96])!.edgeIndex).toBe(2)
    expect(nearestEdgeProjection(rect, [3, 50])!.edgeIndex).toBe(3)
    expect(nearestEdgeProjection(rect, [100, 50], 20)).toBeNull()
  })
})

describe('planOpeningFromClicks', () => {
  it('binds two clicks to the nearest edge as roomId-agnostic edge/offset/width', () => {
    const plan = planOpeningFromClicks(room, [], [40, 3], [90, -2], { maxDistancePx: 10 })
    expect(plan).toMatchObject({ ok: true, edgeIndex: 0, offsetPx: 40, widthPx: 50 })
    if (plan.ok) {
      expect(plan.start).toEqual([40, 0])
      expect(plan.end).toEqual([90, 0])
    }
  })

  it('is independent of click order', () => {
    const plan = planOpeningFromClicks(room, [], [90, 2], [40, 2])
    expect(plan).toMatchObject({ ok: true, offsetPx: 40, widthPx: 50 })
  })

  it('measures offsets along the edge direction on later edges', () => {
    // Edge 2 runs right-to-left, so x=150 is 50px from its start (200,100).
    const plan = planOpeningFromClicks(room, [], [150, 99], [100, 101])
    expect(plan).toMatchObject({ ok: true, edgeIndex: 2, offsetPx: 50, widthPx: 50 })
    if (plan.ok) expect(plan.start).toEqual([150, 100])
  })

  it('clamps a second click past the corner so the opening still fits the edge', () => {
    const plan = planOpeningFromClicks(room, [], [180, 2], [260, 2])
    expect(plan).toMatchObject({ ok: true, edgeIndex: 0, offsetPx: 180, widthPx: 20 })
  })

  it('rejects a first click far from every edge', () => {
    const plan = planOpeningFromClicks(room, [], [100, 50], [120, 50], { maxDistancePx: 12 })
    expect(plan).toEqual({ ok: false, reason: expect.stringContaining('太远') })
  })

  it('rejects a second click that is nowhere near the chosen edge', () => {
    const plan = planOpeningFromClicks(room, [], [50, 1], [50, 90], { maxDistancePx: 12 })
    expect(plan).toEqual({ ok: false, reason: expect.stringContaining('相同的墙边') })
  })

  it('rejects clicks that are too close together', () => {
    const plan = planOpeningFromClicks(room, [], [50, 1], [52, 1])
    expect(plan).toEqual({ ok: false, reason: expect.stringContaining('宽度不足') })
  })

  it('rejects an edge too short to hold an opening', () => {
    const tiny: PixelPoint[] = [[0, 0], [3, 0], [3, 50], [0, 50]]
    const plan = planOpeningFromClicks({ id: 'r1', boundaryPx: tiny }, [], [1, 1], [2, 1])
    expect(plan).toEqual({ ok: false, reason: expect.stringContaining('太短') })
  })

  it('rejects overlap with an existing opening on the same edge only', () => {
    const existing = [opening({ offsetPx: 40, widthPx: 30 })]
    const overlap = planOpeningFromClicks(room, existing, [60, 1], [100, 1])
    expect(overlap).toEqual({ ok: false, reason: expect.stringContaining('o1') })
    expect(planOpeningFromClicks(room, existing, [70, 1], [100, 1]).ok).toBe(true)
    expect(planOpeningFromClicks(room, existing, [60, 99], [100, 99]).ok).toBe(true)
    expect(planOpeningFromClicks(room, [opening({ roomId: 'other', offsetPx: 40 })], [60, 1], [100, 1]).ok)
      .toBe(true)
  })

  it('always produces an opening that fits inside its edge', () => {
    const plan = planOpeningFromClicks(room, [], [190.123, 0.4], [999, 0])
    expect(plan.ok).toBe(true)
    if (plan.ok) expect(plan.offsetPx + plan.widthPx).toBeLessThanOrEqual(200 + 0.01)
  })
})

describe('nextEntityId', () => {
  it('fills the first gap', () => {
    expect(nextEntityId('manual-opening-', [])).toBe('manual-opening-1')
    expect(nextEntityId('manual-opening-', ['manual-opening-1', 'manual-opening-3'])).toBe('manual-opening-2')
  })
})
