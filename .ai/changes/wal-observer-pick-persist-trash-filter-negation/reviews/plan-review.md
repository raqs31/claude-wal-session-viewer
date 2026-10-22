<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Persist session pick, trash sessions, All/None/Not filters

- **Plan**: .ai/changes/wal-observer-pick-persist-trash-filter-negation/plan.md
- **Mode**: Deep
- **Date**: 2026-10-22
- **Verdict**: REVISE → SOUND after fixes
- **Findings**: 1 critical, 4 warnings, 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | WARNING |
| Blind Spots | WARNING |
| Plan Completeness | WARNING |

## Grounding
20/20 paths ✓, 9/9 symbols ✓, brief↔plan ✓, Progress↔Phase ✓

## Findings

### F1 — Same-origin guard breaks `npm run dev`; /trash isn't proxied

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Architectural Fitness
- **Location**: Phase 4 §4 Routes and guard; Phase 5
- **Detail**: `vite.config.ts:13-22` proxies the API with the shorthand form and no `changeOrigin`, so the server sees `Host`/`Origin` `localhost:5173` and the guard returns 403. `/trash` is not proxied.
- **Fix A ⭐ Recommended**: `/trash` proxy entry with `changeOrigin: true` and `headers: { origin: api }`; server guard unchanged.
- **Fix B**: Guard allowlists the vite dev origin.
- **Decision**: FIXED (Fix A)

### F2 — "Live" doesn't protect an open but idle Claude session

- **Severity**: ⚠️ WARNING
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Blind Spots
- **Location**: Phase 4 §2 trash()
- **Detail**: `live` = written in the last 2 min and last WAL event ≠ SessionEnd (`discovery.ts:339`). A session idle at the prompt can be trashed. Claude and the hook would then most likely recreate the files as a fragment, and restore conflicts.
- **Fix A ⭐ Recommended**: `SessionMeta.busy`, set when the session is live or its WAL has no SessionEnd and was written in the last 24 h. Busy sessions are skipped as `live` / `not ended`.
- **Fix B**: Keep the 2-min rule; mark not-ended sessions in the dialog and document the risk.
- **Decision**: FIXED (Fix A)

### F3 — Toggle base (wanted vs. effective) is unspecified

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Completeness
- **Location**: Critical Implementation Details (pick); Phase 1
- **Detail**: If toggle works on wanted, dead ids stay in storage, and unpicking the last shown session gives the newest-session fallback instead of all sessions.
- **Fix**: Toggle starts from the shown pick and writes the result. Add a unit test for it.
- **Decision**: FIXED

### F4 — Cache eviction misses open indexes and the stream path

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 4 §3, §5
- **Detail**: `acquire` serves open indexes without `locate`; a missing file reads as empty (`wal-index.ts:206,314-316`); the LRU skips busy ids; `heads` is never evicted (`discovery.ts:211`).
- **Fix**: `drop` also removes busy entries, discovery drops `heads`/`wals`, and a stream-during-trash test is added.
- **Decision**: FIXED

### F5 — Guard details: bound port unknown in handle(); content-type params

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architectural Fitness
- **Location**: Phase 4 §4
- **Detail**: The bound port is only known in the `listening` handler (`wal-server.ts:328`). fetch sends `application/json;charset=UTF-8`.
- **Fix**: Use `req.socket.localPort` and match on the media type only.
- **Decision**: FIXED

### F6 — Stream negation test is in the wrong file for its criterion

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 2 §1, criterion 2.1
- **Detail**: Stream tests live in `scripts/live-tail.test.ts`.
- **Fix**: Put the stream case in `live-tail.test.ts` and run both files in 2.1.
- **Decision**: FIXED

### F7 — "All" on an include section hides values first seen live

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 2 §4
- **Detail**: All pins today's values, so values that appear later are filtered out. All followed by Not excludes everything.
- **Fix**: README note and manual check 2.10.
- **Decision**: FIXED

### F8 — "Delete N filtered" count vs. pinned picked rows

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 5 §3
- **Detail**: Picked rows are pinned regardless of filters (`Sidebar.tsx:47`), so "picked included" is ambiguous.
- **Fix**: N = `filterRows(...)` result; the dialog lists exactly that set.
- **Decision**: FIXED
