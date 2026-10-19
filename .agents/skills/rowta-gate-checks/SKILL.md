---
name: rowta-gate-checks
description: "Use before reporting any Rowta step or phase and at every phase gate: the forbidden-pattern checks (banned hashing, banned auth phrases, secret scan, tracked env files, token storage, floating promises, hard-coded colours and text) and the env script checks."
---

# rowta-gate-checks

Part of the Rowta method (Section 5 of the Rowta method). Numbering is kept from the original method so cross-references still resolve: see the table in `AGENTS.md`.
Code here is a PATTERN: check every library call against current documentation [VERIFY] before using it, and never paste real secrets (rule S1).

## 5. Gates to run before every report (show the output; each must be empty or as stated)

PowerShell (the owner's machine). Replace paths that do not exist yet with the real folder names.

```
# 1. banned hashing strings outside the one webhook file (A4). Expect no matches.
Get-ChildItem -Recurse -File -Include *.ts,*.tsx,*.js,*.json,*.md,*.yml -Exclude package-lock.json |
  Where-Object { $_.FullName -notmatch 'node_modules|\\\.git\\|webhook-signature\.ts|\\\.agents\\|AGENTS\.md|AGENT-PROMPT\.md|assetlinks\.json' } |
  Select-String -Pattern 'sha-?256|HS256|RS256|ES256|PS256|\bmd5\b|\bsha-?1\b' -CaseSensitive:$false

# 2. banned auth phrases (A5, A6). Expect no matches (list any hit you judge unrelated to accounts, and say why).
Get-ChildItem app,shared,server -Recurse -File -Include *.ts,*.tsx -ErrorAction SilentlyContinue |
  Where-Object { $_.FullName -notmatch 'node_modules|\.test\.|__tests__' } |
  Select-String -Pattern 'incorrect (password|email)|wrong password|email not found|user not found|no account|account does not exist|already (registered|in use|exists|taken)' -CaseSensitive:$false

# 3. secret patterns (S3). Report file and line only, never the text. It must NEVER read .env or .env.* (S2),
#    and it skips .agents (the rules quote the patterns). Expect no matches.
Get-ChildItem -Recurse -File -Exclude package-lock.json |
  Where-Object { $_.FullName -notmatch 'node_modules|\\\.git\\|\\\.agents\\|\\\.env(\..*)?$' } |
  Select-String -Pattern 'AIza|\bsk_(live|test)_|\bsk-[A-Za-z0-9]{10,}|FLWSECK|FLWPUBK|BEGIN [A-Z ]*PRIVATE KEY|(postgres(ql)?|redis)://[^\s:/]+:[^\s@]+@|\b(password|secret|token)\s*[:=]\s*["''][^"'']{8,}["'']' |
  ForEach-Object { "$($_.Path):$($_.LineNumber)" }

# 3b. .env.example holds no value where a secret belongs; .env is ignored and the simulator is off in production.
node scripts/setup-env.mjs --audit-example
node scripts/setup-env.mjs --check

# 4. env files tracked (S3). Expect only .env.example.
git ls-files | Select-String -Pattern '(^|/)\.env'

# 5. banned storage of tokens (A11). Expect no matches.
Get-ChildItem app -Recurse -File -Include *.ts,*.tsx -ErrorAction SilentlyContinue |
  Select-String -Pattern 'AsyncStorage' | Where-Object { $_.Line -match 'token|refresh|access' }

# 6. floating promises and misuse (C1). Run the linter and show the result.
npx eslint . --max-warnings 0

# 7. hard-coded colours and stray pixel numbers in components (U5). Expect no matches outside the tokens file.
Get-ChildItem app/src/components,app/src/screens -Recurse -File -Include *.tsx -ErrorAction SilentlyContinue |
  Select-String -Pattern '#[0-9a-fA-F]{3,8}\b|rgba?\(' 

# 8. hard-coded user text (U8). Review hits by eye: user-visible strings should come from the catalog.
Get-ChildItem app/src -Recurse -File -Include *.tsx -ErrorAction SilentlyContinue | Select-String -Pattern '>\s*[A-Z][a-z]+ [a-z]+'
```

Gates 7 and 8 are heuristics; report hits and say which you judged acceptable and why. Gates 1 to 5 (and 3b) must be empty or
exactly as stated. Also run the test suite and show the summary line.
