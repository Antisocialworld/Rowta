#!/usr/bin/env node
// server-smoke.mjs — boots the real Hono app in-process, hits the real /health endpoints over
// HTTP, and proves the middleware chain (request ID, error envelope) works end to end.
// Usage: node scripts/server-smoke.mjs
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { request as httpRequest } from 'node:http';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
try {
  process.loadEnvFile(resolve(repoRoot, '.env'));
} catch { /* reported via env validation */ }

let failures = 0;
function pass(line) { process.stdout.write(`PASS  ${line}\n`); }
function fail(line) { failures += 1; process.stdout.write(`FAIL  ${line}\n`); }

const { createApp } = await import(pathToFileURL(resolve(repoRoot, 'server/src/index.ts')).href);
const { createRedisConnection } = await import(pathToFileURL(resolve(repoRoot, 'server/src/jobs/queues.ts')).href);
const { logger } = await import(pathToFileURL(resolve(repoRoot, 'server/src/lib/logger.ts')).href);
const { serve } = await import('@hono/node-server');

const redis = createRedisConnection(false);
const app = createApp({ log: logger.child({ test: 'smoke' }), redis });

const { srv, port } = await new Promise((resolve, reject) => {
  const srv = serve({ fetch: app.fetch, port: 0 }, (info) => resolve({ srv, port: info.port }));
  srv.on('error', reject);
});
pass(`server listening on port ${port}`);

function get(path) {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port, path, agent: false }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
    });
    req.on('error', reject);
    req.end();
  });
}

try {
  const health = await get('/health');
  if (health.status === 200 && JSON.parse(health.body).data.status === 'ok') pass('/health returns 200 ok');
  else fail(`/health returned ${health.status}: ${health.body}`);

  const deep = await get('/health/deep');
  const deepBody = JSON.parse(deep.body);
  if (deep.status === 200 && deepBody.data.status === 'ok') pass('/health/deep returns 200 ok with all deps passing');
  else fail(`/health/deep returned ${deep.status}: ${deep.body}`);

  const missing = await get('/definitely-not-a-route');
  const missingBody = JSON.parse(missing.body);
  if (missing.status === 404 && missingBody.error.code === 'not.found' && missingBody.error.requestId) {
    pass('404 returns error envelope with requestId');
  } else fail(`404 handler returned ${missing.status}: ${missing.body}`);
  if (missing.headers['x-request-id']) pass('x-request-id header is set on every response');
  else fail('x-request-id header is missing');
} catch (err) {
  fail(`unexpected error: ${err?.message ?? err}`);
} finally {
  await new Promise((r) => srv.close(() => r()));
  await redis.quit().catch(() => {});
  const { closeAllDatabases } = await import(pathToFileURL(resolve(repoRoot, 'server/src/db/clients.ts')).href);
  await closeAllDatabases();
}

process.stdout.write(failures === 0 ? '\nSMOKE OK\n' : `\nSMOKE FAILED: ${failures} check(s)\n`);
process.exit(failures === 0 ? 0 : 1);
