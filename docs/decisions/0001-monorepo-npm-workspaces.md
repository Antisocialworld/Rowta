# 0001 — Monorepo layout: npm workspaces

- Status: accepted (2026-10-19)
- Related: PRD 5 (stack), PRD 9 (databases), rules P5, D8

## Problem

PRD 5 asks for a monorepo with `/app` (Expo), `/server` (Node API, worker, cron) and `/shared` (Zod schemas used by
both) but does not name a workspace tool. Something must link `/shared` into both other packages without publishing it,
and `/server` must run as ESM (`"type": "module"`) because the Prisma 7 config and the generated clients are ES modules.

## Options

1. **npm workspaces** (chosen). Built into npm, no extra tool, one `package-lock.json` at the root, `npm install` links
   `/shared` into `app` and `server`. Cost: no cross-package task graph or caching (fine at this size); Expo must be
   run from its own workspace.
2. pnpm workspaces. Faster and stricter linking; cost: a second package manager on the owner's machine and a different
   lockfile the owner must learn to commit.
3. Turborepo/Nx. Adds task graphs and caching; cost: another config surface and build cache to explain, for three
   packages that do not need it yet.
4. Three independent folders with `file:` dependencies. Cost: duplicated installs and easy drift between lockfiles.

## Choice

npm workspaces, declared in the root `package.json` (`workspaces: ["app", "server", "shared"]`). `server/package.json`
carries `"type": "module"` and the name `@rowta/server`.

## Why

The owner already has npm (it came with Node). One lockfile is one thing to commit (rule S12), and `--workspace`
flags give per-package commands without extra tooling. Nothing in the PRD needs a task runner today.

## What would change it

Needing a shared build graph (for example if `/shared` had to be compiled to CJS for a tool that cannot read ESM), or
the owner standardising on pnpm. Both are cheap to switch to later; the folders and package names do not change.
