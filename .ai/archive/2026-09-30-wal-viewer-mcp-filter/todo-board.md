# Todo board — opt-in coloured filter chips and "MCP calls" panel in the WAL viewer

Scope: implement approved design (change.md) in `agents/plugins/wal-observer/scripts/index.html` + `README.md`; no server changes; commit at end.

## Phase 1 — Implement
- [x] 1.1 index.html + README per design → verify: `node scripts/query.test.mjs && node scripts/live-tail.test.mjs` pass; page loads without console errors   (model: session)

## Phase 2 — Review
- [x] 2.1 Review diff against design → verify: findings list (or none)   (model: session)

## Phase 3 — Verify
- [x] 3.1 Playwright check on crafted log (opt-in, colours, MCP panel search/bulk/tri-state, Reset) → verify: all checks pass   (model: sonnet)
- [x] 3.2 Commit `feat(wal-observer): …`   (orchestrator)

## Log
- 2026-09-30 Scope confirmed; single impl chunk, review, Playwright verify, commit.
- 2026-09-30 1.1 landed: index.html + README; query/live-tail tests pass; worker smoke-tested in Playwright. Untracked .playwright-mcp/ left at repo root (not ours to commit).
- 2026-09-30 2.1 review: approve, no bugs. Nits → fix chunk (sonnet): dead popover z-index+comment; MCP pill aria-pressed → data-on. Server comment at wal-server.mjs:171 now stale — left (server out of scope), flag to user.
- 2026-09-30 Nits fixed; Playwright re-check (pill data-on, popover on top, Reset) passed; query + live-tail tests pass, page script node --check ok. Committed.

## Phase 4 — Record viewer (JSON | YAML | Raw)
- [x] 4.1 Implement viewer in index.html + README → verify: tests pass, `node --check` page script, Playwright smoke   (model: session)
- [x] 4.2 Review diff against design   (model: session)
- [x] 4.3 Apply findings, Playwright verify (unwrap, YAML `|`, Raw, fold, Copy, persistence), commit   (model: sonnet / orchestrator)
- 2026-09-30 User approved record-viewer design (change.md); Phase 4 added.
- 2026-09-30 4.1 landed: tree viewer, Format JSON/YAML/Raw, normalize, Copy; tests + Playwright smoke pass.
- 2026-09-30 4.2 review: 2 bugs (single-key list items → blank YAML lines; control chars in | block), drift (non-text blocks not recursed; cycling button vs approved segmented control), nits (plurals, YAML 1.1 quoting, lazy copy text). All sent to fix chunk (session model).
- 2026-09-30 4.3 fixes landed (segmented control, YAML fixes, recursion, plurals, lazy copy); query x3 + live-tail pass, node --check ok, PyYAML round-trip 11/11, Playwright smoke ok. One transient query.test timeout seen by worker, not reproduced in 3 reruns. Committed.
