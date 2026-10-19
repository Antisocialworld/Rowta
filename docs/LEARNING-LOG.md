# Learning log

The agent writes a DRAFT entry per phase (what it does, why this way, what breaks it). The owner rewrites each entry in their own words. The 8 interview answers from the brief go at the end.

## Draft: Phase 0, part A — two databases and Prisma

*Draft for the owner to rewrite.*

**What it does.** Rowta keeps its data in two PostgreSQL databases that run as local containers: one holds the global
data (users, currencies, prices) and is also the first shard, the other is the second shard that holds only team data.
The SQL files in `server/prisma/sql/` are the definition of the tables — they are the single source of truth. This
round ran that SQL against both live databases, ran the built-in checks twice (once as the setup role, once as the
role the app will use), and then taught Prisma — the database toolkit — to talk to both databases without ever being
allowed to change the tables.

**Why this way.** Keeping the table definitions in plain SQL files means nobody's tooling can quietly rewrite the
schema: what the database runs is what is in the repo, and re-running the setup is safe because it skips what already
exists. Money is stored as whole minor units (kobo, cents) in a `bigint` column, so a price can never be a fraction of
a cent or drift through floating point. The app's database role can add rows but cannot edit or delete ledger rows —
the database itself refuses — which is what "the ledger is append-only" means in practice, rather than a promise in
the code.

**What breaks it.** Prisma's "read the live database and describe it" step makes one mistake with our schema: three
relationships that are really "one team has many members" look like "one team has one member" to it, because of a
half-unique index we use to allow only one owner per team. A small script fixes those three lines after every read,
and fails loudly if it ever finds a different number, so a future update to Prisma cannot slip past us. Also, the two
full-text search columns are invisible to Prisma, so search will be written as raw SQL; and Prisma's current
"latest" version is an unfinished test version, so the version is pinned and must be bumped on purpose.
