// test-isolation-check — proves the stage-4 guard WITHOUT running any test:
//   1. a TEST_DB0_WRITE_URL that points at a DEV database name (no `_test`) must be refused;
//   2. a TEST_REDIS_URL with no explicit database index must be refused;
//   3. a TEST_REDIS_URL equal to the dev REDIS_URL must be refused;
//   4. a TEST_DB*_URL on a non-local host must be refused;
//   5. properly marked `_test` URLs with Redis index 15 must be accepted;
//   6. the derived Mode B targets (from dev URLs) must be accepted.
// All values are fake, and error messages name variables only — nothing sensitive is printed.
// Run:  npx tsx server/scripts/test-isolation-check.ts
import { deriveTestTargets, validateTestTargets } from '../tests/helpers/test-isolation.ts';

let failures = 0;
const check = (ok: boolean, label: string): void => {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${label}`);
  if (!ok) failures += 1;
};

const DEV = {
  db0Write: 'postgresql://appuser:devpass@127.0.0.1:5442/rowta_db0',
  db1Write: 'postgresql://appuser:devpass@127.0.0.1:5443/rowta_db1',
  redisUrl: 'redis://:redpass@127.0.0.1:6390',
};

const GOOD = {
  db0Write: 'postgresql://appuser:testpass@127.0.0.1:5442/rowta_db0_test',
  db1Write: 'postgresql://appuser:testpass@127.0.0.1:5443/rowta_db1_test',
  redisUrl: 'redis://:redpass@127.0.0.1:6390/15',
};

const guard = (input: Parameters<typeof validateTestTargets>[0]) => validateTestTargets(input);

// 1. dev-named database refused
const devNamed = guard({ ...GOOD, db0Write: DEV.db0Write, devDb0Name: 'rowta_db0', devDb1Name: 'rowta_db1', devRedisUrl: DEV.redisUrl });
check(!devNamed.ok && devNamed.ok === false && devNamed.reason.includes('TEST_DB0_WRITE_URL'), 'a dev-named TEST_DB0_WRITE_URL is refused');

// 2. Redis without an explicit index refused
const noIndex = guard({ ...GOOD, redisUrl: 'redis://:redpass@127.0.0.1:6390', devDb0Name: 'rowta_db0', devDb1Name: 'rowta_db1', devRedisUrl: DEV.redisUrl });
check(!noIndex.ok && noIndex.reason.includes('TEST_REDIS_URL'), 'a TEST_REDIS_URL without an explicit database index is refused');

// 3. Redis equal to dev refused
const sameRedis = guard({ ...GOOD, redisUrl: DEV.redisUrl, devDb0Name: 'rowta_db0', devDb1Name: 'rowta_db1', devRedisUrl: DEV.redisUrl });
check(!sameRedis.ok && sameRedis.reason.includes('TEST_REDIS_URL'), 'a TEST_REDIS_URL equal to the dev REDIS_URL is refused');

// 4. non-local host refused
const remote = guard({ ...GOOD, db0Write: 'postgresql://appuser:testpass@db.example.com:5442/rowta_db0_test', devDb0Name: 'rowta_db0', devDb1Name: 'rowta_db1', devRedisUrl: DEV.redisUrl });
check(!remote.ok && remote.reason.includes('LOCAL'), 'a non-local TEST_DB0_WRITE_URL host is refused');

// 5. properly marked targets accepted
const accepted = guard({ ...GOOD, devDb0Name: 'rowta_db0', devDb1Name: 'rowta_db1', devRedisUrl: DEV.redisUrl });
check(accepted.ok, 'clearly marked _test databases with Redis index 15 are accepted');

// 6. derived Mode B accepted
const derived = deriveTestTargets(DEV);
const derivedVerdict = guard({ ...derived, devDb0Name: 'rowta_db0', devDb1Name: 'rowta_db1', devRedisUrl: DEV.redisUrl });
check(
  derivedVerdict.ok &&
    derivedVerdict.targets.db0Write.endsWith('/rowta_db0_test') &&
    derivedVerdict.targets.redisUrl.endsWith('/15'),
  'the derived Mode B targets (name + _test, Redis index 15) are accepted',
);

// 7. error messages never echo a credential
const devNamedMessage = !devNamed.ok ? devNamed.reason : '';
check(
  !devNamedMessage.includes('devpass') && !devNamedMessage.includes('appuser') && !devNamedMessage.includes('rowta_db0_test'),
  'refusal messages name variables only, never a credential or URL value (S1)',
);

process.exit(failures === 0 ? 0 : 1);
