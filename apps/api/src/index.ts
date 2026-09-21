import { buildServer } from './server'

const port = Number(process.env.PORT ?? 3001)
const server = buildServer()

try {
  await server.listen({ port, host: '0.0.0.0' })
} catch (error) {
  server.log.error(error)
  process.exit(1)
}
