// Data-access module (PRD 9.4; skill rowta-db-sharding-recipes).
//
// This is the ONLY module allowed to import the generated Prisma clients. Routes, middleware and
// jobs go through globalDb()/forTeam()/readDb()/writeDb() so that:
//   - every query is routed to the right database (S7: every query is scoped by teamId),
//   - the app connects as the NON-OWNER app role (DB0_WRITE_URL / DB1_WRITE_URL),
//   - a later phase can add the Redis read-your-own-writes layer behind the same signatures
//     (PRD 9.4: ryw:<userId> with a 5s TTL — deliberately NOT implemented in Phase 0).
//
// Clients are lazy singletons. Nothing opens a connection at import time, so importing this module
// in a test is free until a query actually runs.
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient as GeneratedDb0 } from '../../prisma/generated/db0/client.ts';
import { PrismaClient as GeneratedDb1 } from '../../prisma/generated/db1/client.ts';
import { env } from '../config/env.ts';
import { shardFor, type Shard } from './shard.ts';

// The two generated clients are separate classes over separate schemas (ADR 0002). Callers that
// need a specific model narrow by shard; the health check only needs $queryRaw, which both share.
export type AnyPrismaClient = GeneratedDb0 | GeneratedDb1;

const clients = new Map<Shard, AnyPrismaClient>();

function buildClient(shard: Shard): AnyPrismaClient {
  // Prisma 7 driver-adapter pattern, same as scripts/prisma-smoke.mjs (proven in Phase 0 part A).
  // The app role URL, never the owner/admin URL.
  const url = shard === 0 ? env.DB0_WRITE_URL : env.DB1_WRITE_URL;
  const adapter = new PrismaPg({ connectionString: url });
  return shard === 0
    ? (new GeneratedDb0({ adapter }) as AnyPrismaClient)
    : (new GeneratedDb1({ adapter }) as AnyPrismaClient);
}

/**
 * The database that holds the global tables AND shard 0 (PRD 7.1). The return type is the
 * CONCRETE DB0 client (not the union): every global table (users, sessions, codes) exists only
 * in the DB0 schema (ADR 0002), so auth flows and jobs use named models and $transaction's
 * callback form without narrowing by hand. writeDb() keeps the union for generic calls.
 */
export function globalDb(): GeneratedDb0 {
  return writeDb(0) as GeneratedDb0;
}

/** Route a query to the team's shard. Every team-scoped call in the app goes through this. */
export function forTeam(teamId: string): AnyPrismaClient {
  return writeDb(shardFor(teamId));
}

/**
 * Write path for a shard. Until a real replica exists, READ equals WRITE on purpose (PRD 9.4).
 * Separate functions keep the call sites honest, so swapping in a replica later is a one-file change.
 */
export function writeDb(shard: Shard): AnyPrismaClient {
  const existing = clients.get(shard);
  if (existing) return existing;
  const created = buildClient(shard);
  clients.set(shard, created);
  return created;
}

/** Read path for a shard. Same connection as writeDb until a replica exists (PRD 9.4). */
export function readDb(shard: Shard): AnyPrismaClient {
  return writeDb(shard);
}

/** Close every open client. Used by graceful shutdown and by tests. */
export async function closeAllDatabases(): Promise<void> {
  const open = [...clients.values()];
  clients.clear();
  await Promise.all(open.map((c) => c.$disconnect().catch(() => undefined)));
}

/** Replace or drop the cached client for a shard. Tests only. */
export function __setClientForTests(shard: Shard, client: AnyPrismaClient | null): void {
  if (client === null) clients.delete(shard);
  else clients.set(shard, client);
}
