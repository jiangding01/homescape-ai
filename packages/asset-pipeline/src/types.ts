import type {
  CatalogDimensions,
  CatalogModelFormat,
  CatalogRenderAsset,
} from '@homescape/catalog'

export type AssetLodLevel = 0 | 1 | 2
export type AssetIssueSeverity = 'error' | 'warning'
export type AssetReleaseStatus = 'ready' | 'blocked'

export interface AssetIngestionPolicy {
  maxDimensionErrorRatio: number
  pivotToleranceMeters: number
  maxTrianglesByLod: Readonly<Record<AssetLodLevel, number>>
  maxFileBytesByLod: Readonly<Record<AssetLodLevel, number>>
  maxTextureEdge: number
  requireMeshopt: boolean
  requireKtx2: boolean
  requireSelfContainedGlb: boolean
}

export interface AssetIngestionLodInput {
  level: AssetLodLevel
  sourcePath: string
}

export interface AssetIngestionAssetInput {
  catalogAssetId: string
  sku: string
  expectedDimensions: CatalogDimensions
  lods: readonly AssetIngestionLodInput[]
}

export interface AssetIngestionManifest {
  schemaVersion: '0.1.0'
  releaseVersion: string
  sourceRoot: string
  catalogBaseUri: string
  policy: AssetIngestionPolicy
  assets: readonly AssetIngestionAssetInput[]
}

export interface AssetBounds {
  min: readonly [number, number, number]
  max: readonly [number, number, number]
  dimensions: CatalogDimensions
}

export interface AssetGeometryReport {
  bounds?: AssetBounds
  meshCount: number
  primitiveCount: number
  triangleCount: number
  materialCount: number
  textureCount: number
  maxTextureEdge?: number
  animationCount: number
  skinCount: number
  morphTargetCount: number
  usesMeshopt: boolean
  usesKtx2: boolean
  externalResourceCount: number
}

export interface AssetQAIssue {
  severity: AssetIssueSeverity
  code: string
  message: string
  lodLevel?: AssetLodLevel
}

export interface AssetReleaseLod {
  level: AssetLodLevel
  uri: string
  format: CatalogModelFormat
  byteSize: number
  contentHash: string
  geometry: AssetGeometryReport
}

export interface AssetReleaseRecord {
  catalogAssetId: string
  sku: string
  status: AssetReleaseStatus
  expectedDimensions: CatalogDimensions
  issues: readonly AssetQAIssue[]
  lods: readonly AssetReleaseLod[]
  renderAsset?: CatalogRenderAsset
}

export interface AssetIngestionRelease {
  schemaVersion: '0.1.0'
  releaseVersion: string
  generatedAt: string
  policy: AssetIngestionPolicy
  status: AssetReleaseStatus
  assets: readonly AssetReleaseRecord[]
}
