import type { FloorPlanDraft } from '@homescape/spatial-model'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTrailingThrottle, parseStoredDraft } from './floorplan-annotation-draft-store'

const workingDraft: FloorPlanDraft = {
  schemaVersion: '0.1.0',
  source: { kind: 'floorplan_image', sourceLabel: 'case-001', widthPx: 1000, heightPx: 800 },
  calibration: { startPx: [10, 790], endPx: [110, 790], realDistanceMeters: 1 },
  assumptions: {
    wallThicknessMeters: 0.12,
    wallThicknessConfirmed: false,
    ceilingHeightMeters: 2.6,
    ceilingHeightConfirmed: false,
  },
  rooms: [{ id: 'r1', name: '客厅', boundaryPx: [[0, 0], [100, 0], [100, 100], [0, 100]] }],
  openings: [],
} as unknown as FloorPlanDraft

const row = () => ({
  version: 1,
  sourceLabel: 'case-001',
  savedAt: 1_700_000_000_000,
  exported: false,
  workingDraft: structuredClone(workingDraft),
  editCounts: {
    roomVertexMoves: 3,
    roomMetadataEdits: 1,
    openingGeometryEdits: 2,
    calibrationEdits: 0,
    assumptionEdits: 0,
    resets: 0,
    roomStructureEdits: 1,
  },
  startedAt: 1_699_999_000_000,
  touchedRoomIds: ['r1'],
  sourceImage: null as unknown,
})

describe('parseStoredDraft', () => {
  it('accepts a valid row without an image', () => {
    const parsed = parseStoredDraft(row())
    expect(parsed?.sourceLabel).toBe('case-001')
    expect(parsed?.editCounts.roomVertexMoves).toBe(3)
    expect(parsed?.touchedRoomIds).toEqual(['r1'])
    expect(parsed?.sourceImage).toBeNull()
  })

  it('restores demo and uploaded images', () => {
    const demo = parseStoredDraft({ ...row(), sourceImage: { kind: 'demo', widthPx: 1080, heightPx: 840 } })
    expect(demo?.sourceImage).toEqual({ kind: 'demo', widthPx: 1080, heightPx: 840 })

    const blob = new Blob(['x'], { type: 'image/png' })
    const upload = parseStoredDraft({ ...row(), sourceImage: { kind: 'upload', widthPx: 1000, heightPx: 800 } }, blob)
    expect(upload?.sourceImage).toMatchObject({ kind: 'upload', blob, widthPx: 1000 })
  })

  it('rejects an upload whose Blob is missing', () => {
    expect(parseStoredDraft({ ...row(), sourceImage: { kind: 'upload', widthPx: 1, heightPx: 1 } })).toBeNull()
  })

  it('rejects other versions and malformed content', () => {
    expect(parseStoredDraft(null)).toBeNull()
    expect(parseStoredDraft({ ...row(), version: 2 })).toBeNull()
    expect(parseStoredDraft({ ...row(), exported: 'no' })).toBeNull()
    expect(parseStoredDraft({ ...row(), workingDraft: { rooms: [] } })).toBeNull()
    expect(parseStoredDraft({ ...row(), touchedRoomIds: [1] })).toBeNull()
    expect(parseStoredDraft({ ...row(), startedAt: -1 })).toBeNull()
    const broken = row()
    ;(broken.editCounts as Record<string, unknown>).resets = 'x'
    expect(parseStoredDraft(broken)).toBeNull()
  })

  it('allows editCounts without the optional roomStructureEdits', () => {
    const legacy = row()
    delete (legacy.editCounts as Record<string, unknown>).roomStructureEdits
    expect(parseStoredDraft(legacy)).not.toBeNull()
  })
})

describe('createTrailingThrottle', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('coalesces bursts into one trailing run per interval', () => {
    const run = vi.fn()
    const throttle = createTrailingThrottle(run, 1000)
    throttle.schedule()
    vi.advanceTimersByTime(400)
    throttle.schedule()
    throttle.schedule()
    expect(run).not.toHaveBeenCalled()
    vi.advanceTimersByTime(600)
    expect(run).toHaveBeenCalledTimes(1)
    throttle.schedule()
    vi.advanceTimersByTime(1000)
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('flush runs pending work immediately and only once', () => {
    const run = vi.fn()
    const throttle = createTrailingThrottle(run, 1000)
    throttle.flush()
    expect(run).not.toHaveBeenCalled()
    throttle.schedule()
    throttle.flush()
    expect(run).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(2000)
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('cancel drops pending work', () => {
    const run = vi.fn()
    const throttle = createTrailingThrottle(run, 1000)
    throttle.schedule()
    throttle.cancel()
    vi.advanceTimersByTime(2000)
    expect(run).not.toHaveBeenCalled()
  })
})
