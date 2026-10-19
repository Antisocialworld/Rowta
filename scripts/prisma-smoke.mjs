#!/usr/bin/env node
// prisma-smoke.mjs — prove both generated Prisma clients (db0, db1) connect and behave.
// Uses the APP-role URLs (DB0_WRITE_URL / DB1_WRITE_URL), never the admin ones.
// Read-only: the only write attempt is an append to ledger_entries inside a transaction that ALWAYS rolls back,
// plus updateMany/deleteMany filters that match zero rows. Nothing can be committed. Append is allowed for the
// app role by design (the server appends ledger rows); 030-app-role.sql REVOKEs UPDATE and DELETE on
// ledger_entries so the ledger is append-only in the database itself (D3) - this script proves that through the
// client. No secret, password or URL is printed (S1).
// Usage: node scripts/prisma-smoke.mjs
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PrismaPg } from '@prisma/adapter-pg';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
try {
  process.loadEnvFile(resolve(repoRoot, '.env')); // a program loads .env; nothing is printed (S2)
} catch {
  // reported per-database below
}

const ZERO_UUID = '00000000-0000-0000-0000-000000000000';

function mask(text) {
  let out = String(text ?? '');
  for (const [name, value] of Object.entries(process.env)) {
    if (value && value.length >= 6 && /PASSWORD|SECRET|_URL$|_KEY$|TOKEN/i.test(name)) {
      out = out.split(value).join('******');
    }
  }
  return out.replace(/([a-z][a-z0-9+.-]*:\/\/)([^\s:@/'"]+):([^\s@/'"]+)@/gi, '$1******:******@');
}

function say(line) {
  process.stdout.write(mask(line) + '\n');
}

let failures = 0;
function pass(line) {
  say(`PASS  ${line}`);
}
function fail(line) {
  failures += 1;
  say(`FAIL  ${line}`);
}

function classifyWriteError(err) {
  const text = `${err?.message ?? ''} ${err?.code ?? ''}`;
  if (/permission denied/i.test(text)) return 'refused (permission denied)';
  if (/foreign key/i.test(text)) return 'refused (foreign key) - write reached the database';
  return `UNEXPECTED: ${text.split('\n')[0]}`;
}

async function checkDatabase({ label, urlName, clientRelative, countModel }) {
  say(`--- ${label} (client ${clientRelative}, role from ${urlName}) ---`);
  const connectionString = process.env[urlName];
  if (!connectionString) {
    fail(`${label}: ${urlName} is not set. Run: node scripts/setup-env.mjs --check`);
    return;
  }
  let mod;
  try {
    mod = await import(pathToFileURL(resolve(repoRoot, clientRelative)).href);
  } catch (err) {
    fail(`${label}: cannot import the generated client: ${err?.message}`);
    say('      If this is a TypeScript/type-stripping error, report it to the owner with this line.');
    return;
  }
  const { PrismaClient } = mod;
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  try {
    const count = await prisma[countModel].count();
    pass(`${label}: connected as app role, ${countModel}.count() = ${count}`);

    const [typed] = await prisma.$queryRaw`SELECT 'USD'::text AS code, 2000::bigint AS amount_minor, now()::timestamptz AS at`;
    const moneyIsBigInt = typeof typed.amount_minor === 'bigint';
    const codeIsString = typeof typed.code === 'string';
    const atIsDate = typed.at instanceof Date;
    (moneyIsBigInt && codeIsString && atIsDate ? pass : fail)(
      `${label}: runtime types ${moneyIsBigInt ? 'bigint' : 'WRONG'} (money), ${codeIsString ? 'string' : 'WRONG'} (text), ${atIsDate ? 'Date' : 'WRONG'} (timestamptz)`,
    );

    const before = await prisma.ledger_entries.count();

    // Append is allowed for the app role (the server appends ledger rows); 030-app-role.sql then REVOKEs
    // UPDATE and DELETE so the ledger is append-only in the database, not just in code (D3).
    let appendOutcome = 'not attempted';
    try {
      await prisma.$transaction(async (tx) => {
        try {
          await tx.ledger_entries.create({
            data: { team_id: ZERO_UUID, kind: 'charge', amount_minor: 1n, currency: 'USD', reason: 'smoke-always-rolls-back' },
          });
          appendOutcome = 'append allowed';
        } catch (err) {
          appendOutcome = `REFUSED (${classifyWriteError(err)})`;
        }
        throw new Error('SMOKE_ROLLBACK'); // always roll back, whatever happened above
      });
    } catch (err) {
      if (err?.message !== 'SMOKE_ROLLBACK') throw err;
    }

    // Both filters match zero rows, so even if the privileges were wrong nothing could change.
    async function mustBeRefused(op, run) {
      try {
        const res = await run();
        fail(`${label}: ledger ${op} as app role was NOT refused (result ${JSON.stringify(res)})`);
      } catch (err) {
        (/permission denied/i.test(`${err?.message} ${err?.code}`) ? pass : fail)(
          `${label}: ledger ${op} as app role -> ${classifyWriteError(err)}`,
        );
      }
    }
    await mustBeRefused('updateMany', () => prisma.ledger_entries.updateMany({ where: { team_id: ZERO_UUID }, data: { reason: 'x' } }));
    await mustBeRefused('deleteMany', () => prisma.ledger_entries.deleteMany({ where: { team_id: ZERO_UUID } }));

    const after = await prisma.ledger_entries.count();
    (appendOutcome === 'append allowed' && after === before ? pass : fail)(
      `${label}: ledger append via client -> ${appendOutcome}; ledger_entries rows ${before} -> ${after}`,
    );
  } catch (err) {
    fail(`${label}: unexpected error: ${err?.message}`);
  } finally {
    await prisma.$disconnect().catch(() => {});
  }
}

await checkDatabase({
  label: 'DB0',
  urlName: 'DB0_WRITE_URL',
  clientRelative: 'server/prisma/generated/db0/client.ts',
  countModel: 'currencies',
});
await checkDatabase({
  label: 'DB1',
  urlName: 'DB1_WRITE_URL',
  clientRelative: 'server/prisma/generated/db1/client.ts',
  countModel: 'teams',
});

say(failures === 0 ? 'SMOKE OK: both clients read their own database; the ledger accepts appends and refuses update/delete.' : `SMOKE FAILED: ${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
