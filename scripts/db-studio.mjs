#!/usr/bin/env node
// scripts/db-studio.mjs — launch Prisma Studio safely for db0 or db1.
//
// Rules honoured here:
//   S1: NEVER print a secret, password, key or connection string. Passwords masked with asterisks.
//   S2: Loads .env into process.env at run time; never prints or echoes values.
//   P7: Refuses to run if NODE_ENV=production or if the host is not 127.0.0.1 / localhost.
//
// Usage:
//   npm run db:studio           # db0 on http://localhost:5555 (default)
//   npm run db:studio:db1       # db1 on http://localhost:5556
//   node scripts/db-studio.mjs [db0|db1] [--port <port>] [--browser none]
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const serverDir = resolve(repoRoot, 'server');

// S2: load .env into process.env if present
try {
  process.loadEnvFile(resolve(repoRoot, '.env'));
} catch {
  // .env may already be in environment
}

// Check NODE_ENV: refuse in production
if (process.env.NODE_ENV === 'production') {
  console.error('ERROR: Refusing to start Prisma Studio in production (NODE_ENV=production).');
  process.exit(1);
}

// Parse args
const rawArgs = process.argv.slice(2);
let target = 'db0';
const extraArgs = [];

for (let i = 0; i < rawArgs.length; i++) {
  const arg = rawArgs[i];
  if (arg === 'db0' || arg === 'db1') {
    target = arg;
  } else {
    extraArgs.push(arg);
  }
}

const prefix = target === 'db0' ? 'DB0' : 'DB1';
const host = process.env[`${prefix}_HOST`] || '127.0.0.1';

// Refuse if host is not localhost / 127.0.0.1
if (host !== '127.0.0.1' && host !== 'localhost') {
  console.error(`ERROR: Refusing to start Prisma Studio: host "${host}" is not 127.0.0.1 or localhost.`);
  process.exit(1);
}

const user = process.env[`${prefix}_USER`] || 'rowta';
const password = process.env[`${prefix}_PASSWORD`] || '';
const port = process.env[`${prefix}_PORT`] || (target === 'db0' ? '5442' : '5443');
const dbName = process.env[`${prefix}_NAME`] || (target === 'db0' ? 'rowta_db0' : 'rowta_db1');

// Build database URL strictly in memory (S1: never printed)
const dbUrl = new URL('postgresql://localhost');
dbUrl.username = user;
dbUrl.password = password;
dbUrl.hostname = host;
dbUrl.port = String(port);
dbUrl.pathname = '/' + dbName;
const urlString = dbUrl.toString();

// Set for Prisma config to consume via env('DB0_ADMIN_URL') / env('DB1_ADMIN_URL')
process.env[`${prefix}_ADMIN_URL`] = urlString;

// Ensure schema exists; if missing, invoke existing prisma-pull flow
const schemaPath = resolve(serverDir, 'prisma', target, 'schema.prisma');
if (!existsSync(schemaPath)) {
  console.log(`Schema file missing for ${target}. Running prisma-pull...`);
  const pullRes = spawnSync(process.execPath, [resolve(repoRoot, 'scripts', 'prisma-pull.mjs'), target], {
    cwd: repoRoot,
    stdio: 'inherit',
  });
  if (pullRes.status !== 0) {
    console.error(`ERROR: Failed to introspect schema for ${target}.`);
    process.exit(1);
  }
}

// Determine default port: 5555 for db0, 5556 for db1
const defaultPort = target === 'db0' ? 5555 : 5556;
const hasPortArg = extraArgs.includes('--port') || extraArgs.some((a) => a.startsWith('--port='));
const studioPort = hasPortArg ? undefined : defaultPort;

const configPath = resolve(serverDir, 'prisma', target, 'prisma.config.ts');

const secretValues = Object.keys(process.env)
  .filter((n) => /PASSWORD|SECRET|_URL$|_KEY$|TOKEN/i.test(n) && process.env[n] && process.env[n].length >= 6)
  .map((n) => process.env[n]);

if (password && password.length >= 6) {
  secretValues.push(password);
}
secretValues.push(urlString);

function mask(text) {
  let out = String(text ?? '');
  for (const val of secretValues) {
    if (val && val.length >= 6) out = out.split(val).join('******');
  }
  out = out.replace(/([a-z][a-z0-9+.-]*:\/\/)([^\s:@/'"]+):([^\s@/'"]+)@/gi, '$1******:******@');
  out = out.replace(/\b(password|pwd|user(?:name)?|host|sslmode)=[^\s;&"']+/gi, '$1=******');
  return out;
}

const cliArgs = ['prisma', 'studio', '--config', configPath];
if (studioPort !== undefined) {
  cliArgs.push('--port', String(studioPort));
}
cliArgs.push(...extraArgs);

console.log(`Starting Prisma Studio for ${target} (${dbName} on ${host}:${port})`);
console.log(`Config: server/prisma/${target}/prisma.config.ts`);
if (studioPort !== undefined) {
  console.log(`Listening on: http://localhost:${studioPort} (bound to 127.0.0.1)`);
}
console.log('WARNING: Prisma Studio permits EDITING and DELETING database rows.');
console.log('WARNING: Never screenshot or copy sensitive columns (password_hash, code_hash, verifier_hash).');

const child = spawn('npx', cliArgs, {
  cwd: serverDir,
  shell: true,
  env: process.env,
  stdio: ['inherit', 'pipe', 'pipe'],
});

child.stdout.on('data', (data) => {
  process.stdout.write(mask(data.toString()));
});

child.stderr.on('data', (data) => {
  process.stderr.write(mask(data.toString()));
});

child.on('close', (code) => {
  process.exit(code ?? 0);
});

// Forward termination signals
process.on('SIGINT', () => {
  child.kill('SIGINT');
});
process.on('SIGTERM', () => {
  child.kill('SIGTERM');
});
