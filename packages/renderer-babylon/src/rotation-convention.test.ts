import { NullEngine } from '@babylonjs/core/Engines/nullEngine'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import { Scene } from '@babylonjs/core/scene'
import { rotateLocalToWorld, yawFromDirection } from '@homescape/spatial-model'
import { afterAll, describe, expect, it } from 'vitest'

const engine = new NullEngine()
const scene = new Scene(engine)
// 与 renderer.ts 一致：右手系，直接 rotation.y = yaw。
scene.useRightHandedSystem = true

afterAll(() => {
  scene.dispose()
  engine.dispose()
})

function babylonLocalToWorld(localX: number, localZ: number, yaw: number) {
  const node = new TransformNode('probe', scene)
  node.rotation.y = yaw
  const world = Vector3.TransformCoordinates(
    new Vector3(localX, 0, localZ),
    node.computeWorldMatrix(true),
  )
  node.dispose()
  return [world.x, world.z] as const
}

// Babylon 矩阵为 Float32，比较精度取 1e-6。
const yaws = [0.3, -0.7, 1.1, 2.5, -2.9, Math.PI / 6, (5 * Math.PI) / 7]

describe('旋转约定与 Babylon 渲染一致', () => {
  it.each(yaws)('rotateLocalToWorld 与 Babylon TransformNode 结果一致 (yaw=%s)', (yaw) => {
    for (const [lx, lz] of [
      [1, 0],
      [0, 1],
      [1.3, -0.4],
      [-0.75, 2.1],
    ] as const) {
      const expected = babylonLocalToWorld(lx, lz, yaw)
      const actual = rotateLocalToWorld(lx, lz, yaw)
      expect(actual[0]).toBeCloseTo(expected[0], 6)
      expect(actual[1]).toBeCloseTo(expected[1], 6)
    }
  })

  it('yawFromDirection 让 Babylon 中的局部 +X 指向给定方向', () => {
    for (const [dx, dz] of [
      [3, 1],
      [-2, 5],
      [-1, -4],
      [0.5, -0.2],
    ] as const) {
      const length = Math.hypot(dx, dz)
      const [x, z] = babylonLocalToWorld(1, 0, yawFromDirection(dx, dz))
      expect(x).toBeCloseTo(dx / length, 6)
      expect(z).toBeCloseTo(dz / length, 6)
    }
  })
})
