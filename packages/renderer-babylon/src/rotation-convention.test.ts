import { NullEngine } from '@babylonjs/core/Engines/nullEngine'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import { Scene } from '@babylonjs/core/scene'
import { SceneLoader } from '@babylonjs/core/Loading/sceneLoader'
import '@babylonjs/loaders/glTF'
import {
  FURNITURE_FRONT_LOCAL_AXIS,
  rotateLocalToWorld,
  yawFacingDirection,
  yawFromDirection,
} from '@homescape/spatial-model'
import { readFileSync } from 'node:fs'
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

describe('家具正面约定（局部 −Z）与 Demo 资产、渲染一致', () => {
  it('yawFacingDirection 让 Babylon 中的局部 −Z 指向给定方向', () => {
    for (const [nx, nz] of [
      [0, 1],
      [1, 0],
      [-0.6, 0.8],
      [0.28, -0.96],
    ] as const) {
      const [x, z] = babylonLocalToWorld(
        FURNITURE_FRONT_LOCAL_AXIS[0],
        FURNITURE_FRONT_LOCAL_AXIS[1],
        yawFacingDirection(nx, nz),
      )
      expect(x).toBeCloseTo(nx, 6)
      expect(z).toBeCloseTo(nz, 6)
    }
  })

  it('按渲染器方式实例化 Demo 沙发后，靠背位于正面方向的反侧', async () => {
    const source = readFileSync(
      new URL('../../../apps/web/public/assets/catalog/catalog-sofa-gray-190.gltf', import.meta.url),
      'utf8',
    )
    const container = await SceneLoader.LoadAssetContainerAsync(
      '',
      'data:' + source,
      scene,
      undefined,
      '.gltf',
    )
    const front = [-0.6, 0.8] as const
    const objectRoot = new TransformNode('object-root', scene)
    objectRoot.position = new Vector3(3, 0, 2)
    // 与 renderer.ts 相同：rotation.y = yaw，实例的根节点挂到 objectRoot 下。
    objectRoot.rotation.y = yawFacingDirection(front[0], front[1])
    const instantiated = container.instantiateModelsToScene((name) => 'probe-' + name, false)
    for (const node of instantiated.rootNodes) node.parent = objectRoot

    const nodeCenter = (suffix: string) => {
      const node = scene
        .getNodes()
        .find((candidate) => candidate.name === 'probe-' + suffix) as TransformNode | undefined
      if (!node) throw new Error('缺少节点 ' + suffix)
      // 自上而下强制刷新世界矩阵，避免读到父节点旋转前的缓存。
      const chain: TransformNode[] = []
      for (let current: TransformNode | null = node; current; current = current.parent as TransformNode | null) {
        chain.unshift(current)
      }
      for (const item of chain) item.computeWorldMatrix(true)
      return node.getAbsolutePosition()
    }
    const back = nodeCenter('Back')
    const seat = nodeCenter('Seat')
    const backOffset = (back.x - 3) * front[0] + (back.z - 2) * front[1]
    const seatOffset = (seat.x - 3) * front[0] + (seat.z - 2) * front[1]

    // 靠背在正面方向上的投影为负（位于背后），坐垫比靠背更靠前。
    expect(backOffset).toBeLessThan(-0.3)
    expect(seatOffset).toBeGreaterThan(backOffset)

    instantiated.dispose()
    objectRoot.dispose()
    container.dispose()
  })
})
