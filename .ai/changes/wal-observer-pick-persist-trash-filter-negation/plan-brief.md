# Persist session pick, trash sessions, All/None/Not filters — Plan Brief

> Full plan: `.ai/changes/wal-observer-pick-persist-trash-filter-negation/plan.md`

## What & Why

Three quality-of-life features for the WAL viewer: the picked sessions survive a refresh (and stay in
sync across tabs); old sessions can be cleared off disk from the viewer — via a recoverable trash —
instead of by hand; and filters get All / None / Not so "everything except Read and Grep" is one
click, not ten.

## Starting Point

The pick is in-memory and resets to the newest session on every load (a deliberate 2026-10-09 choice,
after a persisted, synced pick caused re-pick bugs). Filters are include-only sets, matched in one
server-side `matcher`. The server is read-only, GET-only, with no Origin/Host checks.

## Desired End State

Refresh restores the pick; tabs share it; a dead pick falls back to the newest session. Every chip
section (category, tool, event, agent, and sidebar source/workspace) has All / None / Not, with Not
done server-side. The sidebar has Delete picked / Delete N filtered, moving idle sessions to
`<config>/wal-trash/<date>/<slug>/`; a Trash tab restores or permanently deletes them. Write endpoints
reject anything but the viewer's own page.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
| --- | --- | --- |
| Pick storage | localStorage `wal.pick`, synced across tabs | User wants one shared pick across tabs |
| Avoiding the old sync bug | Store the *wanted* pick; write only on user intent; derive the shown pick per tab | Pruning/re-picking written back to storage caused the 2026-10-09 bug |
| Dead pick | Falls back to newest (local, not written) | Never opens an expensive all-sessions query by accident |
| Delete semantics | Move to trash, never hard delete from sidebar | Recoverable by default |
| Trash location | `<config>/wal-trash/<YYYY-MM-DD>/<slug>/`, same source | Same filesystem → atomic renames; mirrors `projects/` layout |
| Move safety | Suffix in place (`.wal-trash`), move, strip suffix; roll back on failure | Session leaves the list in one step; never half-listed |
| Delete scope | Picked, or "N filtered" (sidebar filters, always shown); busy sessions skipped | User choice; busy = written in last 2 min, or not ended (no `SessionEnd`) in last 24 h |
| Trash management | Trash tab: Restore, Delete forever, Empty trash | User wants recovery in the UI |
| Restore clash | Skip and report as conflict | Never overwrite a transcript |
| Confirmation | Modal listing sessions; typed `yes` for permanent delete | Matches `wal legacy`'s guard for the irreversible step |
| Write security | POST + JSON + loopback Host + matching Origin + Sec-Fetch-Site | Blocks other sites and DNS rebinding from deleting sessions |
| Not semantics | Per-section flag, sent as `<field>_not`, matched server-side | A value first seen live is still included |
| All / None | All ticks every offered value; None clears (= no filter) | Matches McpPanel; "empty = no filter" model unchanged |
| Negation in sidebar | Same All / None / Not on source/workspace chips | User choice |
| Release | README per phase; bump to 0.4.0 at the end | Matches the 0.3.0 release |

## Scope

**In scope:** pick persistence + sync; All/None/Not on 4 panel sections and sidebar chips; trash,
restore, purge endpoints + guard; Trash tab and confirm dialog; README; 0.4.0 bump.

**Out of scope:** persisting filters; tri-state chips; trash expiry; OS trash; auto-repair of crash
leftovers; cross-filesystem copy fallback; hardening existing GET routes; publishing.

## Architecture / Approach

Client-only features first (pick, then panel and sidebar filters), then the server trash module
(`scripts/trash.ts`) behind guarded POST routes with integration tests, then the UI that calls it.
Pure logic sits in `web/src/lib/` with `node:test`; filesystem paths come only from discovery's
listing or the trash listing, never from request strings. After a trash the session is evicted from
the WAL index, session store and discovery caches so it reads as unknown everywhere.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Persist the session pick | Restore on refresh, cross-tab sync, newest fallback | Reintroducing the old ping-pong bug |
| 2. Panel All / None / Not | `_not` params in matcher, panel controls, `≠` summary | Agent negation for sessions without tokens |
| 3. Sidebar All / None / Not | Chip negation in `filterRows` | Low |
| 4. Trash on the server | trash / restore / purge / list + same-origin guard | Data loss on a half-done move; CSRF |
| 5. Trash UI | Delete actions, confirm dialog, Trash tab | Deleting more than intended via "N filtered" |
| 6. Release 0.4.0 | Version bump, README pass | Low |

**Prerequisites:** none beyond the current `main`.
**Estimated effort:** ~4–6 sessions; Phase 4 is the largest.

## Open Risks & Assumptions

- Cross-tab sync is the path that failed before; the wanted/effective split is the mitigation and is
  unit-tested, but a two-tab manual check gates Phase 1.
- A crash between suffix and move leaves `*.wal-trash` / `*.wal-restore` files nobody lists; README
  documents the manual fix (accepted tradeoff).
- `projects/` on a different filesystem than its config dir makes trash fail with `EXDEV` (reported,
  rolled back).
- "Delete N filtered" is always shown, so with no filter it covers every idle session; the dialog is
  the only guard.
- Existing GET routes stay readable via DNS rebinding; not addressed here.

## Success Criteria (Summary)

- A refresh or a second tab shows the same picked sessions; a dead pick shows the newest one.
- "Everything except X" is one Not click in any chip section, and live rows respect it.
- Sessions can be trashed, restored and permanently deleted from the viewer, and no other site can
  trigger any of it.
