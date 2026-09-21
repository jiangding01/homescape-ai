import type { DesignScope, DesignState } from '@homescape/domain'
import type { HomeSpatialModel, Vec3 } from '@homescape/spatial-model'

export type RenderModelFormat = 'glb' | 'gltf'

export interface RenderAssetLod {
  level: 0 | 1 | 2
  uri: string
  format: RenderModelFormat
  byteSize?: number
  contentHash?: string
}

export interface RenderAssetSource {
  version: string
  unit: 'meter'
  coordinateSystem: 'right-handed-y-up'
  pivot: 'floor-center'
  lods: readonly RenderAssetLod[]
  compression?: {
    meshopt?: boolean
    ktx2?: boolean
    draco?: boolean
  }
}

export interface RenderObject {
  id: string
  assetId: string
  position: Vec3
  yaw: number
  dimensions?: Vec3
  variantId?: string
  renderAsset?: RenderAssetSource
}

export interface RenderSnapshot {
  spatialModel: HomeSpatialModel
  objects: RenderObject[]
}

export interface RendererCapabilities {
  engine: string
  interactive3D: boolean
  webgl: boolean
  webgpu: boolean
  imageExport: boolean
  gltfAssets: boolean
}

export interface SceneRendererAdapter {
  readonly capabilities: RendererCapabilities

  mount(target: HTMLElement): Promise<void>
  sync(snapshot: RenderSnapshot): Promise<void>
  focus(scope: DesignScope): Promise<void>
  exportImage(): Promise<Blob>
  dispose(): Promise<void>
}

export type RenderAssetResolver = (
  assetId: string,
  variantId?: string,
) => RenderAssetSource | undefined

export interface CreateRenderSnapshotOptions {
  resolveAsset?: RenderAssetResolver
}

export function createRenderSnapshot(
  spatialModel: HomeSpatialModel,
  state: DesignState,
  options: CreateRenderSnapshotOptions = {},
): RenderSnapshot {
  if (spatialModel.id !== state.spatialModelId) {
    throw new Error(
      'RenderSnapshot 的 HomeSpatialModel 与 DesignState 不匹配',
    )
  }

  return {
    spatialModel,
    objects: Object.values(state.objects).map((object) => {
      const renderAsset = options.resolveAsset?.(
        object.assetId,
        object.variantId,
      )

      return {
        id: object.id,
        assetId: object.assetId,
        position: object.transform.position,
        yaw: object.transform.yaw,
        ...(object.dimensions ? { dimensions: object.dimensions } : {}),
        ...(object.variantId ? { variantId: object.variantId } : {}),
        ...(renderAsset ? { renderAsset } : {}),
      }
    }),
  }
}
