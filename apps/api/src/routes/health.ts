import type { FastifyInstance } from 'fastify'

export function registerHealthRoute(server: FastifyInstance) {
  server.get('/api/health', async () => ({
    ok: true,
    service: 'homescape-api',
    version: '0.1.0',
  }))
}
