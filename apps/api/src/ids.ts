import { randomBytes } from 'node:crypto'

export type IdGenerator = () => string

const MAX_SEQUENCE = 0xfff

/**
 * UUID v7（RFC 9562）：48 位毫秒时间戳 + 版本 + 12 位 rand_a + 变体 + 62 位随机数。
 * 同一毫秒内（或时钟回拨时）rand_a 作为单调计数器递增，保证同一生成器产出的 ID 严格递增；
 * 计数器溢出时借用下一毫秒。
 */
export function createUuidV7Generator(
  clock: () => number = Date.now,
  random: (size: number) => Uint8Array = (size) => randomBytes(size),
): IdGenerator {
  let lastMs = -1
  let sequence = 0

  return () => {
    let ms = Math.floor(clock())

    if (ms <= lastMs) {
      ms = lastMs
      sequence += 1

      if (sequence > MAX_SEQUENCE) {
        ms = lastMs + 1
        sequence = 0
      }
    } else {
      // 新毫秒从随机起点开始，只用低 11 位，为同毫秒递增留出空间。
      const seed = random(2)
      sequence = (((seed[0] ?? 0) << 8) | (seed[1] ?? 0)) & 0x7ff
    }

    lastMs = ms

    const bytes = Uint8Array.from(random(16))
    let timestamp = ms

    for (let index = 5; index >= 0; index -= 1) {
      bytes[index] = timestamp % 256
      timestamp = Math.floor(timestamp / 256)
    }

    bytes[6] = 0x70 | (sequence >> 8)
    bytes[7] = sequence & 0xff
    bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80

    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')

    return (
      hex.slice(0, 8) +
      '-' +
      hex.slice(8, 12) +
      '-' +
      hex.slice(12, 16) +
      '-' +
      hex.slice(16, 20) +
      '-' +
      hex.slice(20)
    )
  }
}

export const uuidv7: IdGenerator = createUuidV7Generator()

export const UUID_V7_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

/** 从 UUID v7 取出毫秒时间戳。 */
export function uuidv7Timestamp(id: string) {
  return Number.parseInt(id.replace(/-/g, '').slice(0, 12), 16)
}
