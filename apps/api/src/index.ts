import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildServer } from './server'
import { IN_MEMORY_DATABASE } from './storage/sqlite-store'

const port = Number(process.env.PORT ?? 3001)
// 源码（src/）与构建产物（dist/）都位于 apps/api 下一层，默认库文件即 apps/api/.data/homescape.sqlite。
const databasePath =
  process.env.HOMESCAPE_DB_PATH ||
  fileURLToPath(new URL('../.data/homescape.sqlite', import.meta.url))

if (databasePath !== IN_MEMORY_DATABASE) {
  mkdirSync(dirname(databasePath), { recursive: true })
}

const server = buildServer({ databasePath })

try {
  // 写接口尚无鉴权（ADR-0019），默认只监听本机；需要对外访问时显式设置 HOST。
  await server.listen({ port, host: process.env.HOST ?? '127.0.0.1' })
} catch (error) {
  server.log.error(error)
  process.exit(1)
}
