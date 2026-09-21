export type SpatialSourceKind =
  | 'manual'
  | 'floorplan_image'
  | 'floorplan_pdf'
  | 'cad'
  | 'roomplan'
  | 'video_scan'
  | 'company_data'
  | 'inferred'
  | 'fixture'

export interface SpatialProvenance {
  sourceKind: SpatialSourceKind
  sourceId?: string
  importerId?: string
  confidence?: number
  capturedAt?: string
  note?: string
}
