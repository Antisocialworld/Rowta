// Vercel Serverless Function entry point (Hono 4.13 on Vercel Node.js runtime).
// Builds the Hono app with createApp and exports the serverless handler via hono/vercel handle.
import { handle } from 'hono/vercel';
import type { Redis } from 'ioredis';
import { createApp } from './index.ts';
import { logger } from './lib/logger.ts';
import { createRedisConnection } from './jobs/queues.ts';

let redisInstance: Redis | null = null;

function getLazyRedis(): Redis {
  if (redisInstance === null) {
    redisInstance = createRedisConnection(false);
  }
  return redisInstance;
}

const log = logger.child({ process: 'vercel-api' });

// Lazy redis wrapper: connects only on the first call and reuses the instance across invocations.
const redis = {
  ping: () => getLazyRedis().ping(),
  exists: (key: string) => getLazyRedis().exists(key),
};

const app = createApp({ log, redis });

export const config = {
  runtime: 'nodejs',
};

const handler = handle(app);

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
export const OPTIONS = handler;

export default handler;

