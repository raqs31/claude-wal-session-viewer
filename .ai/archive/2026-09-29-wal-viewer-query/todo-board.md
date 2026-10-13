# Todo board — implement wal-viewer-query per plan.md

Scope: implement plan.md Phases 1–4 autonomously (user-directed); plan committed first. `agents/settings.json` working-tree edit is unrelated — never stage it.

## Phase 1 — Server index and query API
- [x] 1.1 Index, filters, `/events`, `/record`, `query.test.mjs` → verify: `node scripts/query.test.mjs` passes   (model: session)
- [x] 1.R Review phase 1 diff against plan → verify: no blocking findings   (model: session)

## Phase 2 — Filtered live stream
- [x] 2.1 Per-client `/stream`, reset, rewrite `live-tail.test.mjs` → verify: both test scripts pass   (model: session)
- [x] 2.R Review phase 2 diff → verify: no blocking findings   (model: session)

## Phase 3 — Page
- [x] 3.1 Rebuild `index.html` per plan → verify: tests pass, headless page load smoke   (model: session)
- [x] 3.R Review phase 3 diff → verify: no blocking findings   (model: session)

## Phase 4 — Scale check and docs
- [x] 4.1 `bench.mjs` within budgets + README Viewing/Testing → verify: `node scripts/bench.mjs` passes   (model: sonnet)
- [x] 4.R Final review + all checks   (model: session)

## Log
- 2026-09-29 plan committed (6d3b71c); orchestration started
- 2026-09-29 phase 1 landed (d97b067); review found before=2.5 crash + 2 nits, fixed pre-commit; reader refactor carried into phase 2
- 2026-09-29 phase 2 landed (d7d3ae3); review: no blockers; deleted-WAL crash fixed pre-commit; accepted nit: truncate+regrow within one tick undetected
- 2026-09-29 phase 4 landed (e362c45): bench first page 5 ms, q 170 ms, RSS 125-155 MB; no server change
- 2026-09-29 phase 3 landed (8fc8f9d); review: no blockers; view-switch scroll + fetch-error handling fixed pre-commit
- 2026-09-29 accepted nits: pending rows uncapped while paused; stream tool= list frozen at query time when narrowed; "recorded" count lags under filter; truncate+regrow within one tick undetected
- 2026-09-29 left for user: plan 3.3 (local date across days, eyeball) and 4.3 (README matches behaviour)
