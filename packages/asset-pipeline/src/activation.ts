import type { CatalogRenderAsset } from '@homescape/catalog'
import type {
  AssetIngestionRelease,
  AssetReleaseRecord,
} from './types'

export function isAssetReleaseRecordReady(
  record: AssetReleaseRecord,
): record is AssetReleaseRecord & { renderAsset: CatalogRenderAsset } {
  return record.status === 'ready' && record.renderAsset !== undefined
}

export function assertAssetReleaseReady(
  release: AssetIngestionRelease,
) {
  if (release.status !== 'ready') {
    const blocked = release.assets.filter(
      (record) => record.status === 'blocked',
    )

    throw new Error(
      '资产发布被阻断：' +
        blocked
          .map(
            (record) =>
              record.sku +
              ' [' +
              record.issues
                .filter((issue) => issue.severity === 'error')
                .map((issue) => issue.code)
                .join(', ') +
              ']',
          )
          .join('；'),
    )
  }
}

export function collectCatalogRenderAssets(
  release: AssetIngestionRelease,
) {
  assertAssetReleaseReady(release)

  return new Map(
    release.assets.map((record) => {
      if (!isAssetReleaseRecordReady(record)) {
        throw new Error(
          'Release 标记 ready，但资产缺少可激活 RenderAsset：' +
            record.sku,
        )
      }

      return [record.catalogAssetId, record.renderAsset] as const
    }),
  )
}
