import Fastify from 'fastify'
import { registerHealthRoute } from './routes/health'

export function buildServer() {
  const server = Fastify({ logger: true })
  registerHealthRoute(server)
  return server
}
