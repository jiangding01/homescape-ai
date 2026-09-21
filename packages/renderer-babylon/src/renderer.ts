import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera'
import { Engine } from '@babylonjs/core/Engines/engine'
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight'
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight'
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'
import type { AssetContainer } from '@babylonjs/core/assetContainer'
import { SceneLoader } from '@babylonjs/core/Loading/sceneLoader'
import '@babylonjs/loaders/glTF'
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import { Mesh } from '@babylonjs/core/Meshes/mesh'
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder'
import { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData'
import { Scene } from '@babylonjs/core/scene'
import type { DesignScope } from '@homescape/domain'
import type {
  RenderObject,
  RenderSnapshot,
  RendererCapabilities,
  SceneRendererAdapter,
} from '@homescape/renderer-contract'
import {
  distance2D,
  polygonBounds,
  type Floor,
  type Polygon2D,
  type Room,
  type Vec2,
  type Wall,
} from '@homescape/spatial-model'
import { triangulateSimplePolygon } from './triangulate'

interface RendererMaterials {
  floor: StandardMaterial
  wall: StandardMaterial
  structure: StandardMaterial
  utility: StandardMaterial
  object: StandardMaterial
}

export class BabylonSceneRenderer implements SceneRendererAdapter {
  readonly capabilities: RendererCapabilities = {
    engine: 'babylonjs-9',
    interactive3D: true,
    webgl: true,
    webgpu: false,
    imageExport: true,
    gltfAssets: true,
  }

  private engine: Engine | undefined
  private scene: Scene | undefined
  private camera: ArcRotateCamera | undefined
  private canvas: HTMLCanvasElement | undefined
  private resizeObserver: ResizeObserver | undefined
  private spatialRoot: TransformNode | undefined
  private materials: RendererMaterials | undefined
  private snapshot: RenderSnapshot | undefined
  private readonly assetContainerCache = new Map<
    string,
    Promise<AssetContainer>
  >()
  private syncGeneration = 0

  async mount(target: HTMLElement) {
    if (this.engine) {
      throw new Error('BabylonSceneRenderer 已经挂载')
    }

    const canvas = document.createElement('canvas')
    canvas.className = 'homescape-render-canvas'
    canvas.style.display = 'block'
    canvas.style.width = '100%'
    canvas.style.height = '100%'
    canvas.style.touchAction = 'none'
    target.replaceChildren(canvas)

    const engine = new Engine(canvas, true, {
      antialias: true,
      preserveDrawingBuffer: true,
      stencil: true,
    })

    const scene = new Scene(engine)
    scene.useRightHandedSystem = true
    scene.clearColor = new Color4(0.965, 0.953, 0.925, 1)

    const camera = new ArcRotateCamera(
      'homescape-camera',
      -Math.PI / 2.2,
      Math.PI / 3.1,
      14,
      new Vector3(5, 0.8, 4),
      scene,
    )
    camera.lowerRadiusLimit = 1.2
    camera.upperRadiusLimit = 120
    camera.wheelPrecision = 35
    camera.panningSensibility = 850
    camera.minZ = 0.05
    camera.attachControl(canvas, true)

    const ambient = new HemisphericLight(
      'homescape-ambient',
      new Vector3(0.2, 1, 0.1),
      scene,
    )
    ambient.intensity = 0.82

    const sun = new DirectionalLight(
      'homescape-sun',
      new Vector3(-0.45, -1, 0.35),
      scene,
    )
    sun.position = new Vector3(8, 12, -6)
    sun.intensity = 0.55

    const floorMaterial = new StandardMaterial('homescape-floor-material', scene)
    floorMaterial.diffuseColor = Color3.FromHexString('#d8d1c4')
    floorMaterial.specularColor = new Color3(0.12, 0.12, 0.12)
    floorMaterial.backFaceCulling = false

    const wallMaterial = new StandardMaterial('homescape-wall-material', scene)
    wallMaterial.diffuseColor = Color3.FromHexString('#f1eee7')
    wallMaterial.specularColor = new Color3(0.08, 0.08, 0.08)

    const structureMaterial = new StandardMaterial('homescape-structure-material', scene)
    structureMaterial.diffuseColor = Color3.FromHexString('#c3b9aa')
    structureMaterial.specularColor = new Color3(0.08, 0.08, 0.08)

    const utilityMaterial = new StandardMaterial('homescape-utility-material', scene)
    utilityMaterial.diffuseColor = Color3.FromHexString('#7a826c')

    const objectMaterial = new StandardMaterial('homescape-object-material', scene)
    objectMaterial.diffuseColor = Color3.FromHexString('#b4a88f')
    objectMaterial.specularColor = new Color3(0.1, 0.1, 0.1)

    this.canvas = canvas
    this.engine = engine
    this.scene = scene
    this.camera = camera
    this.materials = {
      floor: floorMaterial,
      wall: wallMaterial,
      structure: structureMaterial,
      utility: utilityMaterial,
      object: objectMaterial,
    }

    engine.runRenderLoop(() => {
      scene.render()
    })

    this.resizeObserver = new ResizeObserver(() => engine.resize())
    this.resizeObserver.observe(target)
    engine.resize()
  }

  async sync(snapshot: RenderSnapshot) {
    const scene = this.requireScene()
    const materials = this.requireMaterials()
    const generation = this.syncGeneration + 1
    this.syncGeneration = generation

    this.snapshot = snapshot
    this.spatialRoot?.dispose()

    const root = new TransformNode('homescape-spatial-root', scene)
    this.spatialRoot = root

    for (const floor of snapshot.spatialModel.floors) {
      this.renderFloor(floor, root, scene, materials)
    }

    await Promise.all(
      snapshot.objects.map((object) =>
        this.renderDesignObject(
          object,
          root,
          scene,
          materials,
          generation,
        ),
      ),
    )

    if (
      generation !== this.syncGeneration ||
      root !== this.spatialRoot
    ) {
      return
    }

    await this.focus({
      type: 'project',
      projectId: snapshot.spatialModel.id,
    })
  }

  async focus(scope: DesignScope) {
    const snapshot = this.snapshot
    const camera = this.camera

    if (!snapshot || !camera) return

    if (scope.type === 'object') {
      const object = snapshot.objects.find((candidate) => candidate.id === scope.objectId)

      if (object) {
        camera.setTarget(
          new Vector3(object.position[0], object.position[1] + 0.5, object.position[2]),
        )
        camera.radius = Math.max(camera.lowerRadiusLimit ?? 1.2, 4)
      }

      return
    }

    if (scope.type === 'zone') {
      for (const floor of snapshot.spatialModel.floors) {
        for (const room of floor.rooms) {
          const zone = room.zones.find((candidate) => candidate.id === scope.zoneId)

          if (zone) {
            this.fitPolygon(zone.boundary, floor.elevation, 1.25)
            return
          }
        }
      }

      return
    }

    if (scope.type === 'room') {
      for (const floor of snapshot.spatialModel.floors) {
        const room = floor.rooms.find((candidate) => candidate.id === scope.roomId)

        if (room) {
          this.fitRoom(room, floor.elevation)
          return
        }
      }

      return
    }

    if (scope.type === 'floor') {
      const floor = snapshot.spatialModel.floors.find(
        (candidate) => candidate.id === scope.floorId,
      )

      if (floor) {
        this.fitPoints(
          floor.rooms.flatMap((room) => room.boundary.points),
          floor.elevation,
          1.45,
        )
      }

      return
    }

    this.fitPoints(
      snapshot.spatialModel.floors.flatMap((floor) =>
        floor.rooms.flatMap((room) => room.boundary.points),
      ),
      0,
      1.5,
    )
  }

  async exportImage() {
    const canvas = this.canvas

    if (!canvas) {
      throw new Error('Renderer 尚未挂载')
    }

    return new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => {
          if (blob) resolve(blob)
          else reject(new Error('无法导出当前场景'))
        },
        'image/png',
        1,
      )
    })
  }

  async dispose() {
    this.syncGeneration += 1
    this.resizeObserver?.disconnect()
    this.resizeObserver = undefined
    this.snapshot = undefined
    this.spatialRoot?.dispose()
    this.spatialRoot = undefined

    const containers = [...this.assetContainerCache.values()]
    this.assetContainerCache.clear()
    const settledContainers = await Promise.allSettled(containers)

    for (const result of settledContainers) {
      if (result.status === 'fulfilled') result.value.dispose()
    }
    this.materials = undefined
    this.camera = undefined
    this.scene?.dispose()
    this.scene = undefined
    this.engine?.dispose()
    this.engine = undefined
    this.canvas?.remove()
    this.canvas = undefined
  }

  private async renderDesignObject(
    object: RenderObject,
    root: TransformNode,
    scene: Scene,
    materials: RendererMaterials,
    generation: number,
  ) {
    if (!object.renderAsset) {
      this.renderProxyObject(object, root, scene, materials.object)
      return
    }

    const lod = [...object.renderAsset.lods].sort(
      (a, b) => a.level - b.level,
    )[0]

    if (!lod) {
      this.renderProxyObject(object, root, scene, materials.object)
      return
    }

    try {
      const container = await this.loadAssetContainer(
        object.renderAsset.version + ':' + lod.uri,
        lod.uri,
        scene,
      )

      if (
        generation !== this.syncGeneration ||
        root !== this.spatialRoot
      ) {
        return
      }

      const objectRoot = new TransformNode(
        'render-object-' + object.id,
        scene,
      )
      objectRoot.position = new Vector3(
        object.position[0],
        object.position[1],
        object.position[2],
      )
      objectRoot.rotation.y = object.yaw
      objectRoot.parent = root
      objectRoot.metadata = {
        homescapeType: 'catalog-asset',
        objectId: object.id,
        assetId: object.assetId,
        lod: lod.level,
        uri: lod.uri,
      }

      const instantiated = container.instantiateModelsToScene(
        (sourceName) => object.id + '-' + sourceName,
        false,
      )

      for (const node of instantiated.rootNodes) {
        node.parent = objectRoot
      }
    } catch (error) {
      if (
        generation !== this.syncGeneration ||
        root !== this.spatialRoot
      ) {
        return
      }

      this.renderProxyObject(
        object,
        root,
        scene,
        materials.object,
        error instanceof Error ? error.name : 'asset_load_failed',
      )
    }
  }

  private renderProxyObject(
    object: RenderObject,
    root: TransformNode,
    scene: Scene,
    material: StandardMaterial,
    fallbackReason?: string,
  ) {
    const dimensions =
      object.dimensions ?? ([0.72, 0.72, 0.72] as const)
    const proxy = MeshBuilder.CreateBox(
      'planned-object-' + object.id,
      {
        width: dimensions[0],
        height: dimensions[1],
        depth: dimensions[2],
      },
      scene,
    )
    proxy.position = new Vector3(
      object.position[0],
      object.position[1] + dimensions[1] / 2,
      object.position[2],
    )
    proxy.rotation.y = object.yaw
    proxy.material = material
    proxy.parent = root
    proxy.metadata = {
      homescapeType: 'planned-object-proxy',
      objectId: object.id,
      assetId: object.assetId,
      ...(fallbackReason ? { fallbackReason } : {}),
    }
  }

  private async loadAssetContainer(
    cacheKey: string,
    uri: string,
    scene: Scene,
  ) {
    const cached = this.assetContainerCache.get(cacheKey)
    if (cached) return cached

    const separator = uri.lastIndexOf('/')
    const rootUrl = separator >= 0 ? uri.slice(0, separator + 1) : ''
    const fileName = separator >= 0 ? uri.slice(separator + 1) : uri

    if (!fileName) {
      throw new Error('Render Asset URI 缺少文件名')
    }

    const pending = SceneLoader.LoadAssetContainerAsync(
      rootUrl,
      fileName,
      scene,
    )
    this.assetContainerCache.set(cacheKey, pending)

    try {
      return await pending
    } catch (error) {
      this.assetContainerCache.delete(cacheKey)
      throw error
    }
  }

  private renderFloor(
    floor: Floor,
    root: TransformNode,
    scene: Scene,
    materials: RendererMaterials,
  ) {
    for (const room of floor.rooms) {
      const mesh = this.createPolygonMesh(
        'room-floor-' + room.id,
        room.boundary,
        floor.elevation,
        scene,
      )
      mesh.material = materials.floor
      mesh.parent = root
      mesh.metadata = {
        homescapeType: 'room-floor',
        roomId: room.id,
      }
    }

    for (const wall of floor.walls) {
      this.renderWall(
        wall,
        floor.elevation,
        floor.openings.filter((opening) => opening.wallId === wall.id),
        root,
        scene,
        materials.wall,
      )
    }

    for (const element of floor.structuralElements) {
      if (element.kind === 'column') {
        const column = MeshBuilder.CreateBox(
          'column-' + element.id,
          {
            width: element.size[0],
            depth: element.size[1],
            height: element.height,
          },
          scene,
        )
        column.position = new Vector3(
          element.center[0],
          floor.elevation + element.height / 2,
          element.center[1],
        )
        column.rotation.y = element.rotation
        column.material = materials.structure
        column.parent = root
        continue
      }

      const length = distance2D(element.start, element.end)
      const beam = MeshBuilder.CreateBox(
        'beam-' + element.id,
        {
          width: length,
          depth: element.width,
          height: element.height,
        },
        scene,
      )
      const dx = element.end[0] - element.start[0]
      const dz = element.end[1] - element.start[1]
      beam.position = new Vector3(
        (element.start[0] + element.end[0]) / 2,
        floor.elevation + element.bottomElevation + element.height / 2,
        (element.start[1] + element.end[1]) / 2,
      )
      beam.rotation.y = -Math.atan2(dz, dx)
      beam.material = materials.structure
      beam.parent = root
    }

    for (const anchor of floor.utilityAnchors) {
      const marker = MeshBuilder.CreateSphere(
        'utility-' + anchor.id,
        { diameter: 0.12, segments: 8 },
        scene,
      )
      marker.position = new Vector3(
        anchor.position[0],
        floor.elevation + anchor.position[1],
        anchor.position[2],
      )
      marker.material = materials.utility
      marker.parent = root
      marker.metadata = {
        homescapeType: 'utility-anchor',
        anchorId: anchor.id,
        kind: anchor.kind,
      }
    }
  }

  private renderWall(
    wall: Wall,
    floorElevation: number,
    openings: Floor['openings'],
    root: TransformNode,
    scene: Scene,
    material: StandardMaterial,
  ) {
    const length = distance2D(wall.start, wall.end)
    const sortedOpenings = [...openings].sort((a, b) => a.offset - b.offset)
    let cursor = 0

    const createPiece = (
      name: string,
      startOffset: number,
      pieceLength: number,
      baseHeight: number,
      pieceHeight: number,
    ) => {
      if (pieceLength <= 0.001 || pieceHeight <= 0.001) return

      const dx = wall.end[0] - wall.start[0]
      const dz = wall.end[1] - wall.start[1]
      const unitX = dx / length
      const unitZ = dz / length
      const centerOffset = startOffset + pieceLength / 2
      const piece = MeshBuilder.CreateBox(
        name,
        {
          width: pieceLength,
          depth: wall.thickness,
          height: pieceHeight,
        },
        scene,
      )

      piece.position = new Vector3(
        wall.start[0] + unitX * centerOffset,
        floorElevation + baseHeight + pieceHeight / 2,
        wall.start[1] + unitZ * centerOffset,
      )
      piece.rotation.y = -Math.atan2(dz, dx)
      piece.material = material
      piece.parent = root
      piece.metadata = {
        homescapeType: 'wall',
        wallId: wall.id,
      }
    }

    for (const opening of sortedOpenings) {
      const openingStart = Math.max(cursor, Math.min(length, opening.offset))
      const openingEnd = Math.max(
        openingStart,
        Math.min(length, opening.offset + opening.width),
      )

      createPiece(
        'wall-' + wall.id + '-segment-' + cursor.toFixed(3),
        cursor,
        openingStart - cursor,
        0,
        wall.height,
      )

      const sillHeight = Math.max(0, opening.sillHeight ?? 0)
      const openingHeight = Math.min(opening.height, Math.max(0, wall.height - sillHeight))
      const topStart = sillHeight + openingHeight

      createPiece(
        'wall-' + wall.id + '-opening-lower-' + opening.id,
        openingStart,
        openingEnd - openingStart,
        0,
        sillHeight,
      )
      createPiece(
        'wall-' + wall.id + '-opening-upper-' + opening.id,
        openingStart,
        openingEnd - openingStart,
        topStart,
        wall.height - topStart,
      )

      cursor = Math.max(cursor, openingEnd)
    }

    createPiece(
      'wall-' + wall.id + '-segment-end',
      cursor,
      length - cursor,
      0,
      wall.height,
    )
  }

  private createPolygonMesh(
    name: string,
    polygon: Polygon2D,
    elevation: number,
    scene: Scene,
  ) {
    const mesh = new Mesh(name, scene)
    const indices = triangulateSimplePolygon(polygon.points)
    const positions: number[] = []
    const normals: number[] = []
    const uvs: number[] = []
    const bounds = polygonBounds(polygon)
    const width = Math.max(bounds.width, 0.001)
    const depth = Math.max(bounds.depth, 0.001)

    for (const [x, z] of polygon.points) {
      positions.push(x, elevation, z)
      normals.push(0, 1, 0)
      uvs.push((x - bounds.min[0]) / width, (z - bounds.min[1]) / depth)
    }

    const vertexData = new VertexData()
    vertexData.positions = positions
    vertexData.indices = indices
    vertexData.normals = normals
    vertexData.uvs = uvs
    vertexData.applyToMesh(mesh)

    return mesh
  }

  private fitRoom(room: Room, elevation: number) {
    this.fitPolygon(room.boundary, elevation, 1.3)
  }

  private fitPolygon(polygon: Polygon2D, elevation: number, margin: number) {
    this.fitPoints(polygon.points, elevation, margin)
  }

  private fitPoints(points: readonly Vec2[], elevation: number, margin: number) {
    const camera = this.camera

    if (!camera || points.length === 0) return

    const minX = Math.min(...points.map((point) => point[0]))
    const maxX = Math.max(...points.map((point) => point[0]))
    const minZ = Math.min(...points.map((point) => point[1]))
    const maxZ = Math.max(...points.map((point) => point[1]))
    const width = Math.max(1, maxX - minX)
    const depth = Math.max(1, maxZ - minZ)

    camera.setTarget(
      new Vector3(
        (minX + maxX) / 2,
        elevation + 0.8,
        (minZ + maxZ) / 2,
      ),
    )
    camera.alpha = -Math.PI / 2.2
    camera.beta = Math.PI / 3.1
    camera.radius = Math.max(width, depth) * margin + 2
  }

  private requireScene() {
    if (!this.scene) throw new Error('Renderer 尚未挂载')
    return this.scene
  }

  private requireMaterials() {
    if (!this.materials) throw new Error('Renderer 尚未挂载')
    return this.materials
  }
}
