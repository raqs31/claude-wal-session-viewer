---
change_id: wal-observer-ts-react
title: wal-observer — port to strict TypeScript (server, hook) and React + Vite (page), behaviour unchanged
status: archived
created: 2026-09-30
updated: 2026-09-30
archived_at: 2026-09-30T11:44:27Z
---

## Notes

— The viewer is one ~700-line `index.html` plus `.mjs` server/hook; the planned Sessions tab (`wal-sessions-tab`) would
double it. Port first with identical behaviour, then build Sessions on the new stack. Design approved in conversation
2026-09-30 (§1 revised: build at use time, no committed build output).

## Approved design (2026-09-30)

### Goal and success criteria

Same observable behaviour as commit `d049c79` (Events page, endpoints, live stream, hook records), now written in strict
TypeScript with the page in React. Done when:

1. `npm run check` (tsc, server + web) is clean.
2. `npm test` passes: the ported `query`, `live-tail` suites, the new `web/src/lib` unit tests; `bash hooks/wal-hook.test.sh`
   passes against the `.ts` hook; `bench` budgets still hold.
3. The Playwright parity check (§4) reports no difference between the old page (from git) and the new one.
4. `/wal` from a fresh plugin copy installs, builds and serves the page; `./install.sh` re-sync keeps the installed
   `node_modules` and `web/dist`.

Out of scope: any new feature (Sessions tab is the next change), UI redesign, UI libraries, table virtualisation.

### §1 Layout and tooling

```
agents/plugins/wal-observer/
  package.json        private; devDependencies only: typescript, @types/node, vite, @vitejs/plugin-react,
                      react, react-dom, @types/react, @types/react-dom
  package-lock.json   committed, so every host installs the same versions
  tsconfig*.json      strict, noEmit, erasableSyntaxOnly, allowImportingTsExtensions; server and web projects
  shared/api.ts       /events, /record, stream-row and filter types, imported by server AND web
  hooks/wal-hook.ts   (+ wal-hook.test.sh targeting the .ts)
  scripts/            wal-server.ts, bench.ts, query.test.ts, live-tail.test.ts
  web/                index.html, vite.config.ts, src/
  web/dist/           build output — gitignored
  node_modules/       gitignored
```

- npm scripts: `wal-observer` = `vite build` then `node scripts/wal-server.ts` (args pass through after `--`);
  `check` = tsc over both projects; `test` = `node --test`; `dev` = Vite dev server proxying `/events`, `/stream`,
  `/record` to a running wal-server; `bench`.
- `/wal` (`commands/wal.md`) runs
  `cd "${CLAUDE_PLUGIN_ROOT}" && npm install && npm run wal-observer -- --file="<project>/.ai/logs/wal.jsonl" $ARGUMENTS`.
  `--file` is explicit because the `cd` moves the cwd the server would otherwise resolve the log from. `allowed-tools`
  gains `Bash(npm:*)`. It still reads the printed port and opens it with `xdg-open`.
- `install.sh` `sync_unix_conf_plugins`: `diff -rq` and `rsync -a --delete` exclude `node_modules` and `web/dist`,
  otherwise every sync wipes them from the installed copy and flags the plugin as changed. Repo `.gitignore` covers both.
- The hook stays dependency-free: `node hooks/wal-hook.ts` runs on every event and never needs `npm install`.
- Requirement: a `node` with type stripping on PATH for Claude Code. Checked NEULA014 only (per user): the distro
  `/usr/bin/node` v22.22.1 is built WITHOUT TypeScript (`ERR_NO_TYPESCRIPT`); nvm's v24.20.0 has it
  (`process.features.typescript === 'strip'`). nvm stays lazy in zsh, so `config/zsh/config/35_paths.zsh` prepends the
  newest installed nvm node's `bin` to PATH without sourcing nvm.sh; Claude Code started from zsh inherits it.
  `scripts/bwrap-run` passes that host PATH into the sandbox and binds `~/.nvm` read-only, so no sandbox change is
  needed. Done outside the plan.
  Known risk (not checked, per user): another host syncing this plugin with a TS-less `node` loses WAL logging (the
  hook exits 1 — non-blocking — instead of recording).
- Accepted cost: first `/wal` on a host needs network + npm; later runs pay a no-op `npm install` plus a Vite build.

### §2 Server and hook

- Straight port of `wal-server.mjs` → `wal-server.ts`: index, tail, reader, matcher, query, SSE clients, MCP pairing,
  truncation/gen handling unchanged. Index entry, filters and responses become types from `shared/api.ts`.
- Serves the built page: `/` → `web/dist/index.html`; other paths resolved inside `web/dist` only (no traversal), with
  content types for html/js/css/svg/json/map; API routes unchanged.
- `wal-hook.mjs` → `wal-hook.ts`, keeping its guarantees: always exit 0, never write stdout, one append per event, value
  clamping. `hooks.json` points at `.ts`. Hook start-up time measured before and after (it runs on every event).

### §3 Web (React + Vite)

- Pure logic in `web/src/lib/*.ts` (no React, testable with `node --test`): query params builder, tool colours +
  server hash, MCP name parsing/grouping, `normalize`, the JSON/YAML tree walker + text emitter.
- Components: `FilterBar` (search, session select, category chips, tool chips, `McpPanel` popover, date/time/duration
  fields, Reset), `StatsHeader` (hero + tiles), `EventTable` (rows, infinite scroll, Tail/Table modes, "N new" pill),
  `RecordViewer` (tree, JSON | YAML | Raw segmented control, Copy).
- Hooks: `useEvents` (query + SSE, generation guard dropping stale responses, `reset` on truncation),
  `useStored` (`wal.view`, `wal.format`).
- Tail-mode scroll anchoring stays imperative inside `EventTable` via refs; React re-renders must not move the view.
- Styling: current CSS carried over (same palette variables, light/dark). All log data rendered as text, never as HTML.

### §4 Tests and parity

- Port `query.test`, `live-tail.test`, `bench` to TypeScript on `node:test`, same assertions. Hook test runs the `.ts`.
- New unit tests for `web/src/lib`: normalize, YAML round-trip cases from the `wal-viewer-mcp-filter` review (single-key
  list items, control chars, `<<`/`=`, NEL/LS/PS, `|` blocks), params builder, MCP grouping, colour hash.
- Parity check: a scripted checklist driven with the Playwright MCP tools (no Playwright npm dependency) runs the old page (from git at `d049c79`, `.mjs` server) and the new page against the
  same crafted log, drives the same actions (filters, chips, MCP panel search/bulk/tri-state, Reset, Tail/Table, format
  switch, expand rows), and compares visible rows, request params and formatted record text.
- Docs: README (run, develop, test sections), `commands/wal.md`; `AGENTS.md` pointer only if it names a changed path.

## Deviations

- 2026-09-30 — Hook stays `hooks/wal-hook.mjs` (JSDoc + `checkJs`, covered by `npm run check`): the `.ts` port measured +30 ms per event start-up (20 calls: 0.51 s → 1.10 s), at the plan's limit; user chose to keep plain JS. hooks.json and wal-hook.test.sh unchanged.
