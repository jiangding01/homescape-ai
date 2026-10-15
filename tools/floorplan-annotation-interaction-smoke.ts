import assert from 'node:assert/strict'
import { lockAnnotationBackgroundScroll } from '../apps/web/src/floorplan-annotation-scroll-lock'
import { clickNearStart, clampViewport, fullViewport, insertPolygonVertex, orthogonalEdge, orthogonalPoint, removePolygonVertex, zoomViewport } from '../apps/web/src/floorplan-annotation-geometry'

assert.deepEqual(orthogonalPoint([100, 100], [220, 119]), [220, 100])
assert.deepEqual(orthogonalPoint([100, 100], [116, 230]), [100, 230])
// Closing corner snaps onto the first point's axis so the last edge is orthogonal.
assert.deepEqual(orthogonalPoint([402, 300], [103, 298], [100, 100], 5), [100, 300])
assert.deepEqual(orthogonalPoint([402, 300], [130, 298], [100, 100], 5), [130, 300])
assert.equal(orthogonalEdge([100, 100], [150, 100]), true)
assert.equal(orthogonalEdge([100, 100], [150, 125]), false)
assert.equal(clickNearStart([100, 100], [105, 105], 2), true)
assert.equal(clickNearStart([100, 100], [115, 115], 4), false)
const full = fullViewport(992, 992)
const middle = zoomViewport(full, 2, 992, 992)
assert.deepEqual(middle, { x: 248, y: 248, width: 496, height: 496 })
assert.deepEqual(zoomViewport(middle, 0.5, 992, 992), full)
assert.equal(zoomViewport(full, 100, 992, 992).width, 124)
assert.deepEqual(clampViewport({ x: -100, y: 900, width: 400, height: 400 }, 992, 992), {
  x: 0, y: 592, width: 400, height: 400,
})
assert.equal(zoomViewport(fullViewport(992, 562), 2, 992, 562).height, 281)
process.stderr.write('FloorPlan annotation interaction geometry smoke passed\n')

const room = { id: 'r1', name: '客餐厅', type: 'living', boundaryPx:
  [[0, 0], [10, 0], [10, 10], [0, 10], [0, 5]] as [number, number][] }
const openings = [
  { id: 'door', roomId: 'r1', edgeIndex: 0, kind: 'door', offsetPx: 1, widthPx: 2, heightMeters: 2.1 },
  { id: 'window', roomId: 'r1', edgeIndex: 2, kind: 'window', offsetPx: 2, widthPx: 3, heightMeters: 1.4 },
] as const
const reduced = removePolygonVertex(room, openings, 4)
assert.equal(reduced.room.boundaryPx.length, 4)
assert.deepEqual(reduced.openings.map(o => o.edgeIndex), [0, 2])
assert.throws(() => removePolygonVertex(room, openings, 0), /Opening/)
assert.throws(() => removePolygonVertex({ ...room, boundaryPx: room.boundaryPx.slice(0, 3) }, [], 0), /至少保留 3/)
const extended = insertPolygonVertex(room, openings, 1)
assert.deepEqual(extended.room.boundaryPx[2], [10, 5])
assert.deepEqual(extended.openings.map(o => o.edgeIndex), [0, 3])
assert.throws(() => insertPolygonVertex(room, openings, 0), /Opening/)
const removedFirst = removePolygonVertex({ ...room, boundaryPx: room.boundaryPx.slice(0, 4) },
  [{ ...openings[1], edgeIndex: 2 }], 0)
assert.equal(removedFirst.openings[0]?.edgeIndex, 1)

const scrollHost = {
  documentElement: { style: { overflow: 'auto', overscrollBehavior: 'contain' } },
  body: { style: { overflow: '', overscrollBehavior: '' } },
}
const unlock = lockAnnotationBackgroundScroll(scrollHost)
assert.equal(scrollHost.documentElement.style.overflow, 'hidden')
assert.equal(scrollHost.body.style.overflow, 'hidden')
assert.equal(scrollHost.documentElement.style.overscrollBehavior, 'none')
assert.equal(scrollHost.body.style.overscrollBehavior, 'none')
unlock()
assert.deepEqual(scrollHost, {
  documentElement: { style: { overflow: 'auto', overscrollBehavior: 'contain' } },
  body: { style: { overflow: '', overscrollBehavior: '' } },
})
// Locking after cleanup must also restore correctly (simulated React StrictMode cycle).
lockAnnotationBackgroundScroll(scrollHost)()
assert.equal(scrollHost.documentElement.style.overflow, 'auto')
