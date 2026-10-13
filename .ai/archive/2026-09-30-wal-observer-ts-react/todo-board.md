# Todo board — wal-observer: migrate plain .mjs server/hook/page to strict TS + React (plan.md Tasks 1–7)

Scope: plan.md Tasks 1–7 on branch `feat/wal-observer-ts-react` (main checkout), one Conventional Commit per task,
review after each phase. Task 8 (go live on NEULA014) stays with the user. Never stage `agents/settings.json` or
`.playwright-mcp/`.

## Phase 1 — Toolchain, server and hook in TypeScript
- [x] 1.1 Task 1: toolchain skeleton + `shared/api.ts` + .gitignore → verify: `npx tsc --version` 7.x, tsc clean, node_modules not in git status   (model: sonnet)
- [x] 1.2 Task 2: server, query/live-tail tests, bench → .ts, static serving → verify: tsc clean, both test files `all checks passed`, bench budgets ok   (model: sonnet)
- [x] 1.3 Task 3 (revised by user): hook stays .mjs, JSDoc + checkJs → verify: hook test `all checks passed`, shellcheck clean, start-up within +0.6 s/20 calls   (model: sonnet)
- [x] 1.R Phase 1 review → verify: no blocking findings   (model: session)
- [x] 1.F Fix review findings 1–2 → verify: tests pass, guard-removal makes new test fail   (model: sonnet)

## Phase 2 — Page logic and React page
- [x] 2.1 Task 4: `web/src/lib` port + unit tests → verify: tsc clean, `node --test web/src/lib/*.test.ts` passes   (model: session)
- [x] 2.2 Task 5: React page, built-page checks, smoke + anchoring check, `git rm scripts/index.html` → verify: `npm run check && npm run build && npm test`, anchoring < 2 px   (model: session)
- [x] 2.R Phase 2 review → verify: no blocking findings   (model: session)
- [x] 2.F Fix review findings: memo RecordViewer/Tree, Reset clears invalid inputs, escape U+2028 in tree.test.ts → verify: npm test, perf re-measure, Reset probe   (model: session)

## Phase 3 — Parity, launch, docs
- [x] 3.1 Task 6: Playwright parity old (d049c79) vs new → `parity.md` → verify: every row `same` or `DIFF` with reason; `npm test` passes   (model: session)
- [x] 3.2 Task 7: `/wal` via npm, install.sh sync excludes, README → verify: scratch-copy install/sync proof, `npm run check && npm test`   (model: sonnet)
- [x] 3.R Final review + required checks pasted → verify: `npm run check && npm test`, shellcheck on touched scripts   (model: session)

## Log
- 2026-09-30 User confirmed scope: Tasks 1–7, branch off main in place, commit per task, review per phase.
- 2026-09-30 1.1 landed 9440c7c (TS 7.0.2, Vite 8.3.1, React 19.3.0).
- 2026-09-30 1.2 landed db4f821; tests pass, bench first page 8 ms, RSS 228 MB.
- 2026-09-30 1.3: .ts hook measured +30 ms/event (0.51 s → 1.10 s per 20), at the limit. User chose: keep hook .mjs. Landed 205c3cf (JSDoc + checkJs, Deviations noted in change.md).
- 2026-09-30 1.R review: no blocking; should-fix: static stream error crashes server (wal-server.ts:328), traversal test doesn't exercise guard (query.test.ts:173) → chunk 1.F.
- 2026-09-30 1.F landed 98d872e (stream error handler; raw traversal test proven to bite).
- 2026-09-30 Found: unix-conf marketplace is a directory source → wal-observer hooks run straight from the repo; workers must not touch hooks/.
- 2026-09-30 2.1 landed 61536c2; 12/12 lib tests; old vs new equal on 60k random inputs. Note: copyText re-normalizes per click (~5 ms/1 MB).
- 2026-09-30 2.2 dispatched (session model).
- 2026-09-30 2.2 landed 1540f27; npm test 14/14; anchoring 0 px; scripts/index.html removed.
- 2026-09-30 2.R: no blocking. should-fix: unmemoised RecordViewer/Tree (format switch 10–22 ms old vs 625–1408 ms new on 180k-node record), Reset leaves badInput text. Nits: scroll-change batching (accepted, theoretical), badge wording (plan only), raw U+2028 in tree.test.ts (fix).
- 2026-09-30 2.F landed 0a8d7d8; format switch (row closed) 4–17 ms vs old 7–17 ms; Reset remounts inputs via key; U+2028 escaped.
- 2026-09-30 3.1 dispatched (session model).
- 2026-09-30 3.1 landed da05d89; 113 same / 0 DIFF. Inherited quirk kept (row 100): Table view + Follow on never shows the `↑ N new` pill (old atEdge always true there) — follow-up for the user, out of scope (frozen behaviour).
- 2026-09-30 3.2 dispatched (sonnet).
- 2026-09-30 3.2 landed d53049f; scratch install/sync proof: 200 text/html, node_modules + web/dist survive re-sync, in sync; shellcheck install.sh unchanged (0 findings).
- 2026-09-30 3.R final review: no blocking. Fixed in aab006b: /wal via `npm --prefix` (allow rules match, no cd), wait-for-port note, install.sh diff-exclude comment, plan Task 8 wording, README cwd. Bench re-run: all budgets ok (RSS 228 MB).
- 2026-09-30 Required checks green: `npm run check` clean, `npm test` 14/14 + hook test, `bash -n`/shellcheck clean on install.sh and wal-hook.test.sh. Tasks 1–7 done. Remaining for the user: Task 8 (fresh zsh + restart, ./install.sh, live /wal), merge of feat/wal-observer-ts-react. Follow-ups: parity row 100 quirk (Table + Follow never shows pill); .playwright-mcp/ not gitignored.
