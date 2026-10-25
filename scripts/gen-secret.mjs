#!/usr/bin/env node
// Generates a cryptographically strong 64-byte random secret printed as 128 hex characters.
// Output format: exactly one line of 128 lowercase hex characters.
// Never reads .env, never writes to disk.
import { randomBytes } from 'node:crypto';

process.stdout.write(`${randomBytes(64).toString('hex')}\n`);
