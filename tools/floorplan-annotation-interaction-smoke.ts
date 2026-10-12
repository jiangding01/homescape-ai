import assert from 'node:assert/strict'
import { clickNearStart, clampViewport, fullViewport, orthogonalEdge, orthogonalPoint, zoomViewport } from '../apps/web/src/floorplan-annotation-geometry'

assert.deepEqual(orthogonalPoint([100, 100], [220, 119]), [220, 100])
assert.deepEqual(orthogonalPoint([100, 100], [116, 230]), [100, 230])
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
