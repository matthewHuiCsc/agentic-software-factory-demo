import Fastify, { type FastifyInstance } from 'fastify';
import { z } from 'zod';

export type HealthApp = FastifyInstance;

export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

export const idParams = z.strictObject({ id: z.uuid() });
export const pagination = {
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(10000).default(0),
};

export function createHealthApp(
  component: string,
  readiness?: () => Promise<void>,
): FastifyInstance {
  const app = Fastify({ logger: true });
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof z.ZodError) {
      request.log.info({ issues: error.issues }, 'Request validation failed');
      return reply
        .code(400)
        .send({ error: 'Invalid request', issues: error.issues });
    }
    if (error instanceof HttpError) {
      request.log.info(
        { statusCode: error.statusCode, message: error.message },
        'Request rejected',
      );
      return reply.code(error.statusCode).send({ error: error.message });
    }
    if (
      error instanceof Error &&
      'statusCode' in error &&
      typeof error.statusCode === 'number' &&
      error.statusCode >= 400 &&
      error.statusCode < 500
    ) {
      request.log.info({ err: error }, 'Invalid HTTP request');
      return reply.code(error.statusCode).send({ error: error.message });
    }
    request.log.error({ err: error }, 'Request failed');
    return reply.code(500).send({ error: 'Internal server error' });
  });
  app.get('/health', async (request, reply) => {
    if (readiness) {
      try {
        await readiness();
      } catch (error) {
        request.log.error({ err: error }, 'Database readiness check failed');
        return reply.code(503).send({ status: 'unavailable', component });
      }
    }
    return { status: 'ok', component };
  });
  return app;
}

export async function start(app: FastifyInstance): Promise<void> {
  try {
    const port = Number(process.env.PORT ?? 3000);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error('PORT must be an integer between 1 and 65535');
    }
    await app.listen({ port, host: '0.0.0.0' });
  } catch (error) {
    app.log.error(error);
    process.exitCode = 1;
    await app.close();
    return;
  }

  let closing = false;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    try {
      await app.close();
    } catch (error) {
      app.log.error(error);
      process.exitCode = 1;
    }
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}
