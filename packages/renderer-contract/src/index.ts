import type { DesignScope, DesignState } from '@homescape/domain'
import type { HomeSpatialModel, Vec3 } from '@homescape/spatial-model'

export interface RenderObject {
  id: string
  assetId: string
  position: Vec3
  yaw: number
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
}

export interface SceneRendererAdapter {
  readonly capabilities: RendererCapabilities

  mount(target: HTMLElement): Promise<void>
  sync(snapshot: RenderSnapshot): Promise<void>
  focus(scope: DesignScope): Promise<void>
  exportImage(): Promise<Blob>
  dispose(): Promise<void>
}

export function createRenderSnapshot(
  spatialModel: HomeSpatialModel,
  state: DesignState,
): RenderSnapshot {
  if (spatialModel.id !== state.spatialModelId) {
    throw new Error(
      'RenderSnapshot 的 HomeSpatialModel 与 DesignState 不匹配',
    )
  }

  return {
    spatialModel,
    objects: Object.values(state.objects).map((object) => ({
      id: object.id,
      assetId: object.assetId,
      position: object.transform.position,
      yaw: object.transform.yaw,
    })),
  }
}
