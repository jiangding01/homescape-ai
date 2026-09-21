import Fastify from 'fastify'
import { createDesignCommandInterpreterFromEnv } from './ai'
import { registerDesignInterpretRoute } from './routes/design-interpret'
import { registerHealthRoute } from './routes/health'

export function buildServer() {
  const server = Fastify({ logger: true })
  const designCommandInterpreter = createDesignCommandInterpreterFromEnv()

  registerHealthRoute(server)
  registerDesignInterpretRoute(server, designCommandInterpreter)

  return server
}
