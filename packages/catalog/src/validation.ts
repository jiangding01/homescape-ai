import type { CatalogAsset, CatalogRenderAssetLod } from './types'

export interface CatalogValidationIssue {
  code: string
  assetId: string
  message: string
}

function isPositiveFinite(value: number) {
  return Number.isFinite(value) && value > 0
}

function isSupportedAssetUri(uri: string) {
  return (
    (uri.startsWith('/') && !uri.startsWith('//')) ||
    uri.startsWith('https://')
  )
}

function uriMatchesFormat(
  uri: string,
  format: CatalogRenderAssetLod['format'],
) {
  const path = uri.split(/[?#]/, 1)[0]?.toLowerCase() ?? ''
  return path.endsWith('.' + format)
}

function validateLod(
  assetId: string,
  lod: CatalogRenderAssetLod,
): CatalogValidationIssue[] {
  const issues: CatalogValidationIssue[] = []

  if (!isSupportedAssetUri(lod.uri)) {
    issues.push({
      code: 'catalog.render_asset_uri_unsupported',
      assetId,
      message: 'Render Asset 只允许站内绝对路径或 HTTPS URI：' + lod.uri,
    })
  }

  if (!uriMatchesFormat(lod.uri, lod.format)) {
    issues.push({
      code: 'catalog.render_asset_format_mismatch',
      assetId,
      message:
        'Render Asset URI 扩展名与声明格式不一致：' +
        lod.uri +
        ' / ' +
        lod.format,
    })
  }

  if (
    lod.byteSize !== undefined &&
    (!Number.isInteger(lod.byteSize) || lod.byteSize <= 0)
  ) {
    issues.push({
      code: 'catalog.render_asset_byte_size_invalid',
      assetId,
      message: 'Render Asset byteSize 必须是正整数',
    })
  }

  return issues
}

export function validateCatalogAsset(
  asset: CatalogAsset,
): CatalogValidationIssue[] {
  const issues: CatalogValidationIssue[] = []

  if (!asset.id.trim() || !asset.sku.trim() || !asset.category.trim()) {
    issues.push({
      code: 'catalog.identity_missing',
      assetId: asset.id,
      message: 'CatalogAsset 必须包含非空 id / sku / category',
    })
  }

  if (
    !isPositiveFinite(asset.dimensions.width) ||
    !isPositiveFinite(asset.dimensions.height) ||
    !isPositiveFinite(asset.dimensions.depth)
  ) {
    issues.push({
      code: 'catalog.dimensions_invalid',
      assetId: asset.id,
      message: 'CatalogAsset dimensions 必须全部为正数且单位为 meter',
    })
  }

  if (asset.renderAsset) {
    if (!asset.renderAsset.version.trim()) {
      issues.push({
        code: 'catalog.render_asset_version_missing',
        assetId: asset.id,
        message: 'Render Asset version 不能为空',
      })
    }

    if (
      asset.renderAsset.unit !== 'meter' ||
      asset.renderAsset.coordinateSystem !== 'right-handed-y-up' ||
      asset.renderAsset.pivot !== 'floor-center'
    ) {
      issues.push({
        code: 'catalog.render_asset_not_normalized',
        assetId: asset.id,
        message:
          'Render Asset 必须离线归一化为 meter / right-handed-y-up / floor-center',
      })
    }

    if (asset.renderAsset.lods.length === 0) {
      issues.push({
        code: 'catalog.render_asset_lod_missing',
        assetId: asset.id,
        message: 'Render Asset 至少需要一个 LOD',
      })
    }

    const levels = new Set<number>()

    for (const lod of asset.renderAsset.lods) {
      if (levels.has(lod.level)) {
        issues.push({
          code: 'catalog.render_asset_lod_duplicate',
          assetId: asset.id,
          message: 'Render Asset LOD level 不能重复：' + lod.level,
        })
      }

      levels.add(lod.level)
      issues.push(...validateLod(asset.id, lod))
    }

    if (asset.renderAsset.lods.length > 0 && !levels.has(0)) {
      issues.push({
        code: 'catalog.render_asset_lod0_missing',
        assetId: asset.id,
        message: 'Render Asset 必须提供 LOD0 作为主模型',
      })
    }
  }

  return issues
}

export function validateCatalogAssets(
  assets: readonly CatalogAsset[],
): CatalogValidationIssue[] {
  const issues: CatalogValidationIssue[] = []
  const ids = new Set<string>()
  const skus = new Set<string>()

  for (const asset of assets) {
    if (ids.has(asset.id)) {
      issues.push({
        code: 'catalog.id_duplicate',
        assetId: asset.id,
        message: 'CatalogAsset id 重复：' + asset.id,
      })
    }

    if (skus.has(asset.sku)) {
      issues.push({
        code: 'catalog.sku_duplicate',
        assetId: asset.id,
        message: 'CatalogAsset sku 重复：' + asset.sku,
      })
    }

    ids.add(asset.id)
    skus.add(asset.sku)
    issues.push(...validateCatalogAsset(asset))
  }

  return issues
}

export function assertCatalogAssetsValid(
  assets: readonly CatalogAsset[],
) {
  const issues = validateCatalogAssets(assets)

  if (issues.length === 0) return

  throw new Error(
    'Catalog 校验失败：' +
      issues.map((issue) => issue.code + ' ' + issue.message).join('；'),
  )
}
