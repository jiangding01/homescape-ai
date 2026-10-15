import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { SharpVisionImagePreparer } from './sharp-vision-image-preparer'

async function syntheticPlan(width: number, height: number) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <rect width="100%" height="100%" fill="white"/>
    <rect x="40" y="40" width="${width - 80}" height="${height - 80}" fill="none" stroke="black" stroke-width="12"/>
  </svg>`
  return new Uint8Array(await sharp(Buffer.from(svg)).png().toBuffer())
}

describe('SharpVisionImagePreparer', () => {
  it('等比缩放到长边上限并记录两套尺寸', async () => {
    const prepared = await new SharpVisionImagePreparer({ maxLongEdgePx: 800 }).prepare(
      await syntheticPlan(1600, 600),
      'image/png',
    )

    expect(prepared.sourceWidthPx).toBe(1600)
    expect(prepared.sourceHeightPx).toBe(600)
    expect(prepared.modelWidthPx).toBe(800)
    expect(prepared.modelHeightPx).toBe(300)
    expect(prepared.mediaType).toBe('image/png')
    const metadata = await sharp(prepared.bytes).metadata()
    expect([metadata.width, metadata.height]).toEqual([800, 300])
  })

  it('小图不放大', async () => {
    const prepared = await new SharpVisionImagePreparer().prepare(
      await syntheticPlan(400, 300),
      'image/png',
    )
    expect([prepared.modelWidthPx, prepared.modelHeightPx]).toEqual([400, 300])
  })

  it('同一输入的预处理结果哈希稳定', async () => {
    const bytes = await syntheticPlan(1200, 900)
    const preparer = new SharpVisionImagePreparer({ maxLongEdgePx: 600 })
    const first = await preparer.prepare(bytes, 'image/png')
    const second = await preparer.prepare(bytes, 'image/png')
    expect(second.sha256).toBe(first.sha256)
  })

  it('拒绝非 PNG / JPEG', async () => {
    await expect(
      new SharpVisionImagePreparer().prepare(new Uint8Array([1]), 'image/webp'),
    ).rejects.toThrow()
  })
})
