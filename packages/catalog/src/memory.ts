import type {
  CatalogAsset,
  CatalogQuery,
  CatalogRepository,
} from './types'

function numericAttribute(asset: CatalogAsset, key: string) {
  const value = asset.attributes?.[key]
  return typeof value === 'number' ? value : undefined
}

export class InMemoryCatalog implements CatalogRepository {
  private readonly assets: readonly CatalogAsset[]

  constructor(assets: readonly CatalogAsset[]) {
    this.assets = [...assets]
  }

  async search(query: CatalogQuery) {
    return this.assets.filter((asset) => {
      if (!asset.active || asset.category !== query.category) return false
      if (query.minWidth !== undefined && asset.dimensions.width < query.minWidth) return false
      if (query.maxWidth !== undefined && asset.dimensions.width > query.maxWidth) return false
      if (query.maxDepth !== undefined && asset.dimensions.depth > query.maxDepth) return false
      if (query.maxPrice !== undefined && (asset.price === undefined || asset.price > query.maxPrice)) {
        return false
      }

      if (query.minSeats !== undefined) {
        const seats = numericAttribute(asset, 'seats')
        if (seats === undefined || seats < query.minSeats) return false
      }

      if (
        query.colorFamily &&
        !asset.variants?.some((variant) => variant.colorFamily === query.colorFamily)
      ) {
        return false
      }

      if (
        query.styleTags &&
        !query.styleTags.every((tag) => asset.tags.includes(tag))
      ) {
        return false
      }

      return true
    })
  }

  async getById(id: string) {
    return this.assets.find((asset) => asset.id === id)
  }
}
