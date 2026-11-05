#!/usr/bin/env node
// Fixture test for scripts/check-ui-tokens.mjs (owner scope, 20 Oct 2026).
// Proves the three behaviours of the server/src/mail px exception with REAL probe files:
//   1. px inside a file under server/src/mail/ PASSES the gate (email clients need px);
//   2. a hex colour inside server/src/mail/ still FAILS the gate (only 'css px' is excepted);
//   3. px anywhere else (here: server/src/ outside mail) still FAILS the gate.
// Every probe is created inside the real scan tree, the real gate is spawned, and the probe is
// deleted in a finally block — no probe file survives a run. Run: node scripts/test-ui-tokens-gate.mjs
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GATE = path.join(ROOT, 'scripts', 'check-ui-tokens.mjs');

const PROBES = [
  {
    file: path.join(ROOT, 'server', 'src', 'mail', 'gate-probe-px.html'),
    content: '<p style="font-size: 18px; letter-spacing: 2px;">gate probe px</p>\n',
    expectPass: true,
    label: 'px under server/src/mail passes',
  },
  {
    file: path.join(ROOT, 'server', 'src', 'mail', 'gate-probe-colour.html'),
    content: '<div style="background-color: #ff0000;">gate probe colour</div>\n',
    expectPass: false,
    mustContain: ['server/src/mail/gate-probe-colour.html', '[hex colour]'],
    mustNotContain: ['server/src/mail/templates.ts'],
    label: 'hex colour under server/src/mail still fails (and real mail px stays excepted)',
  },
  {
    file: path.join(ROOT, 'server', 'src', 'gate-probe-px.html'),
    content: '<div style="width: 16px;">gate probe px outside mail</div>\n',
    expectPass: false,
    mustContain: ['server/src/gate-probe-px.html', '[css px in stylesheet]'],
    label: 'px under server/src (outside mail) still fails',
  },
];

function runGate() {
  const res = spawnSync(process.execPath, [GATE], { encoding: 'utf8', cwd: ROOT });
  return { status: res.status, output: `${res.stdout ?? ''}${res.stderr ?? ''}` };
}

let failures = 0;
for (const probe of PROBES) {
  fs.mkdirSync(path.dirname(probe.file), { recursive: true });
  fs.rmSync(probe.file, { force: true });
  try {
    fs.writeFileSync(probe.file, probe.content, 'utf8');
    const { status, output } = runGate();
    const problems = [];
    if (probe.expectPass && status !== 0) {
      problems.push(`expected PASS (exit 0), got exit ${status}:\n${output}`);
    }
    if (!probe.expectPass && status === 0) {
      problems.push('expected FAIL (exit 1), got exit 0');
    }
    for (const needle of probe.mustContain ?? []) {
      if (!output.includes(needle)) problems.push(`output must contain ${needle}:\n${output}`);
    }
    for (const needle of probe.mustNotContain ?? []) {
      if (output.includes(needle)) problems.push(`output must NOT contain ${needle}:\n${output}`);
    }
    if (problems.length === 0) {
      console.log(`PASS: ${probe.label}`);
    } else {
      failures += 1;
      console.error(`FAIL: ${probe.label}`);
      for (const p of problems) console.error(`  ${p}`);
    }
  } finally {
    fs.rmSync(probe.file, { force: true });
  }
}

// Baseline: with every probe removed the real repository must pass the gate.
const baseline = runGate();
if (baseline.status === 0) {
  console.log('PASS: real repository passes the gate with no probe files present');
} else {
  failures += 1;
  console.error(`FAIL: real repository must pass the gate, got exit ${baseline.status}:\n${baseline.output}`);
}

if (failures > 0) {
  console.error(`${failures} probe check(s) failed`);
  process.exit(1);
}
console.log('UI TOKEN GATE PROBES: all passed');
