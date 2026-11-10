// Test-isolation guard (stage 4, 28 Oct 2026). PURE module — no imports from the app graph, so the
// vitest setup file can run it BEFORE anything loads env.ts/clients.ts. It validates where the
// server suite may connect and refuses loudly, by NAME only (URLs hold credentials — never echoed, S1).
//
// Two supported ways to point the suite at throwaway databases:
//   Mode A (explicit): TEST_DB0_WRITE_URL / TEST_DB1_WRITE_URL / TEST_REDIS_URL are set in the
//     environment (shell or server/.env.test — see server/.env.test.example).
//   Mode B (derived): none of the TEST_* names are set; the suite derives them from the dev URLs
//     by appending `_test` to each database name and moving Redis to database index 15 of the same
//     instance. The derived values inherit the local credentials and are never printed.
// The guard refuses unless: the URLs parse, the hosts are local (127.0.0.1 / localhost / ::1), each
// database NAME ends with `_test` and differs from its dev name, and the test Redis target differs
// from the dev Redis target (an explicit database index, different from the dev one when present).

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

export type TestTargets = { db0Write: string; db1Write: string; redisUrl: string };

export type IsolationVerdict =
  | { ok: true; targets: TestTargets }
  | { ok: false; reason: string };

export function dbNameOf(url: string): string {
  return url.replace(/\/+$/, '').split('/').pop() ?? '';
}

export function validateTestTargets(input: {
  db0Write: string;
  db1Write: string;
  redisUrl: string;
  devDb0Name: string;
  devDb1Name: string;
  devRedisUrl: string;
}): IsolationVerdict {
  const refuse = (reason: string): IsolationVerdict => ({ ok: false, reason });

  for (const [label, value] of [
    ['TEST_DB0_WRITE_URL', input.db0Write],
    ['TEST_DB1_WRITE_URL', input.db1Write],
    ['TEST_REDIS_URL', input.redisUrl],
  ] as const) {
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      return refuse(`${label} is not a valid URL.`);
    }
    if (parsed.hostname === '') {
      return refuse(`${label} is not a valid URL.`);
    }
    if (!LOCAL_HOSTS.has(parsed.hostname)) {
      return refuse(`${label} must point at a LOCAL host (127.0.0.1/localhost/::1); the suite never runs against a remote database or Redis.`);
    }
  }

  for (const [label, url, devName] of [
    ['TEST_DB0_WRITE_URL', input.db0Write, input.devDb0Name],
    ['TEST_DB1_WRITE_URL', input.db1Write, input.devDb1Name],
  ] as const) {
    const name = dbNameOf(url);
    if (!name.endsWith('_test')) {
      return refuse(`${label} must name a clearly-marked TEST database (the name must end with _test); got a non-test database name.`);
    }
    if (name === devName) {
      return refuse(`${label} points at the DEV database (${devName}); the suite must never run against the dev databases.`);
    }
  }

  const testRedis = new URL(input.redisUrl);
  const redisIndex = testRedis.pathname.replace(/^\/+/, '');
  if (redisIndex === '' || !/^\d+$/.test(redisIndex)) {
    return refuse('TEST_REDIS_URL must use an explicit Redis database index (e.g. .../15) so the suite can never share the dev keyspace.');
  }
  if (input.devRedisUrl === input.redisUrl) {
    return refuse('TEST_REDIS_URL must differ from the dev REDIS_URL (a different database index or instance).');
  }
  const devRedisIndex = (() => {
    try {
      return new URL(input.devRedisUrl).pathname.replace(/^\/+/, '');
    } catch {
      return '';
    }
  })();
  if (/^\d+$/.test(devRedisIndex) && devRedisIndex === redisIndex) {
    return refuse('TEST_REDIS_URL uses the same Redis database index as the dev instance; the suite must never share the dev keyspace.');
  }

  return { ok: true, targets: { db0Write: input.db0Write, db1Write: input.db1Write, redisUrl: input.redisUrl } };
}

/** Derive Mode B targets from the dev URLs: database name + `_test`, Redis index 15. */
export function deriveTestTargets(dev: {
  db0Write: string;
  db1Write: string;
  redisUrl: string;
}): TestTargets {
  const renameDb = (url: string): string => {
    const parsed = new URL(url);
    const pieces = parsed.pathname.split('/');
    pieces[pieces.length - 1] = `${pieces[pieces.length - 1]}_test`;
    parsed.pathname = pieces.join('/');
    return parsed.toString();
  };
  const redis = new URL(dev.redisUrl);
  redis.pathname = '15';
  return { db0Write: renameDb(dev.db0Write), db1Write: renameDb(dev.db1Write), redisUrl: redis.toString() };
}
