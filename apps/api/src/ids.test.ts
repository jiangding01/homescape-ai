import { describe, expect, it } from 'vitest'
import { createUuidV7Generator, UUID_V7_PATTERN, uuidv7, uuidv7Timestamp } from './ids'

describe('UUID v7', () => {
  it('符合 RFC 9562 的版本与变体位', () => {
    for (let index = 0; index < 100; index += 1) {
      expect(uuidv7()).toMatch(UUID_V7_PATTERN)
    }
  })

  it('编码毫秒时间戳', () => {
    const ms = Date.UTC(2026, 9, 15, 8, 30, 0, 123)
    const next = createUuidV7Generator(() => ms)

    expect(uuidv7Timestamp(next())).toBe(ms)
  })

  it('同一毫秒内大量生成仍唯一且严格递增', () => {
    const next = createUuidV7Generator(() => 1_700_000_000_000)
    const ids = Array.from({ length: 10_000 }, () => next())

    expect(new Set(ids).size).toBe(ids.length)
    expect([...ids].sort()).toEqual(ids)
    ids.forEach((id) => expect(id).toMatch(UUID_V7_PATTERN))
  })

  it('时钟回拨时不倒退', () => {
    let now = 2_000
    const next = createUuidV7Generator(() => now)
    const first = next()
    now = 1_000
    const second = next()

    expect(second > first).toBe(true)
    expect(uuidv7Timestamp(second)).toBe(2_000)
  })

  it('同毫秒计数器溢出时借用下一毫秒', () => {
    const next = createUuidV7Generator(
      () => 5_000,
      (size) => new Uint8Array(size).fill(0xff),
    )
    const ids = Array.from({ length: 0x1000 }, () => next())

    expect(new Set(ids).size).toBe(ids.length)
    expect([...ids].sort()).toEqual(ids)
    expect(uuidv7Timestamp(ids.at(-1) ?? '')).toBe(5_001)
  })
})
