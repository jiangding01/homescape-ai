export type PlacementAnchor = 'wall' | 'center' | 'free'

export interface CatalogDimensions {
  width: number
  height: number
  depth: number
}

export interface CatalogVariant {
  id: string
  name: string
  colorFamily?: string
  materialFamily?: string
}

export interface CatalogPlacementRules {
  anchors: readonly PlacementAnchor[]
  wallClearance: number
  collisionPadding: number
  allowRotation: boolean
}

export type CatalogModelFormat = 'glb' | 'gltf'

export interface CatalogRenderAssetLod {
  level: 0 | 1 | 2
  uri: string
  format: CatalogModelFormat
  byteSize?: number
  contentHash?: string
}

export interface CatalogRenderAsset {
  version: string
  unit: 'meter'
  coordinateSystem: 'right-handed-y-up'
  pivot: 'floor-center'
  lods: readonly CatalogRenderAssetLod[]
  compression?: {
    meshopt?: boolean
    ktx2?: boolean
    draco?: boolean
  }
}

export interface CatalogAsset {
  id: string
  sku: string
  name: string
  category: string
  dimensions: CatalogDimensions
  placement: CatalogPlacementRules
  tags: readonly string[]
  active: boolean
  price?: number
  variants?: readonly CatalogVariant[]
  attributes?: Readonly<Record<string, string | number | boolean>>
  renderAsset?: CatalogRenderAsset
}

export interface CatalogQuery {
  category: string
  minWidth?: number
  maxWidth?: number
  maxDepth?: number
  maxPrice?: number
  minSeats?: number
  colorFamily?: string
  styleTags?: readonly string[]
}

export interface CatalogRepository {
  search(query: CatalogQuery): Promise<readonly CatalogAsset[]>
  getById(id: string): Promise<CatalogAsset | undefined>
}
