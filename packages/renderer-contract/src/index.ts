import type { DesignRevision, DesignScope } from '@homescape/domain'
import type { PlannedObject } from '@homescape/planner'
import type { HomeSpatialModel } from '@homescape/spatial-model'

export interface RenderSnapshot {
  spatialModel: HomeSpatialModel
  objects: PlannedObject[]
}

export interface SceneRendererAdapter {
  mount(target: HTMLElement): Promise<void>
  sync(snapshot: RenderSnapshot): Promise<void>
  applyRevision(revision: DesignRevision): Promise<void>
  focus(scope: DesignScope): Promise<void>
  exportImage(): Promise<Blob>
  dispose(): Promise<void>
}
