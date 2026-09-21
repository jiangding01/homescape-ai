import type { DesignScope } from '@homescape/domain'
import type { PlannedObject } from '@homescape/planner'
import type { HomeSpatialModel } from '@homescape/spatial-model'

export interface RenderSnapshot {
  spatialModel: HomeSpatialModel
  objects: PlannedObject[]
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
