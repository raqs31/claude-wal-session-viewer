# wal-observer TS + React Port Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port wal-observer (server, hook, tests, viewer page) to strict TypeScript with the page in React + Vite, keeping behaviour identical to commit `d049c79`.

**Architecture:** Server, hook, tests and pure page logic are `.ts` files run directly by Node 24's type stripping (no compile step). The page is React + Vite, built at launch time by `npm run wal-observer`, which then starts the server; the server serves `web/dist`. API types live once in `shared/api.ts`.

**Tech Stack:** Node 24 (nvm, type stripping), TypeScript 7 (`tsc --noEmit` only), React 19, Vite 8, `node:test`, Playwright MCP tools for the parity check.

**Spec:** `.ai/changes/wal-observer-ts-react/change.md`

## Global Constraints

- Plugin root: `agents/plugins/wal-observer/` (all relative paths below are from it unless they start with the repo root `/home/mraczynski/.config/unix_conf/`).
- Node for every command in THIS Claude session: prefix with `export PATH="$HOME/.nvm/versions/node/v24.20.0/bin:$PATH";` — this session started with the distro `/usr/bin/node` v22.22.1, which is built without TypeScript (`ERR_NO_TYPESCRIPT`). Verify once: `node -p process.features.typescript` prints `strip`.
- TypeScript is erasable-only: no `enum`, `namespace`, parameter properties, or `import =`. Relative imports carry the `.ts`/`.tsx` extension. Type-only imports use `import type`.
- Runtime dependencies: none. The hook must never need `node_modules` (it runs on every event, before any `npm install`). Everything in `package.json` is a devDependency.
- No build output in git: `web/dist/` and `node_modules/` are gitignored.
- Behaviour is frozen at `d049c79`: every endpoint, query param, SSE frame, record shape, CSS variable, localStorage key (`wal.view`, `wal.format`) and visible text stays the same. No new features, no UI library, no table virtualisation.
- The hook keeps its guarantees: always exit 0, never write stdout, one append per event, value clamping (`CLAUDE_WAL_MAX_STRING`/`_ARRAY`/`_LINE`).
- Log data is rendered as text only — never `dangerouslySetInnerHTML`, never `innerHTML`.
- Comments: why-only, terse, matching the existing files. Carry over the existing why-comments that still apply.
- Commits: Conventional Commits, one per task, no attribution trailers. Never stage `agents/settings.json` or `.playwright-mcp/` (unrelated working-tree state).
- Shell scripts: `bash -n` and `shellcheck` before committing (repo rule).

## Review Focus

- A WAL that does not exist yet or is empty: page loads, shows 0 events and "No events match this filter.", live dot turns `live`, first appended line appears. (Task 2 test "missing file", Task 6 parity step.)
- Truncating/deleting the WAL while the page is open: stream sends `reset`, page re-queries, expanded rows do not show bytes from the new file (409 → requery). (Task 2 live-tail test kept; Task 6 parity step.)
- Tail mode loading older pages while the user is scrolled up: the visible rows must not jump. (Task 5 Step "anchoring" check; Task 6 parity step.)
- Huge records (a 1 MB+ `tool_response`) expanded in JSON/YAML: no freeze beyond the old page's cost; copy text built only on click. (Task 4 test with a 1 MB string; Task 6 parity step.)
- `/wal` on a copy of the plugin that never ran `npm install`, and `./install.sh` re-sync afterwards: install+build+serve works, re-sync keeps `node_modules` and `web/dist`. (Task 7 steps.)

---

### Task 1: Tooling skeleton and shared API types

**Files:**
- Create: `package.json`, `package-lock.json` (by npm), `tsconfig.json`, `web/tsconfig.json`, `shared/api.ts`
- Modify: `/home/mraczynski/.config/unix_conf/.gitignore`

**Interfaces:**
- Produces: `shared/api.ts` exports `Category`, `McpRole`, `Row`, `Page`, `FirstPage`, `WalRecord`, `McpCallRecord`, `RecordResponse`, `CATEGORIES`. npm scripts `wal-observer`, `build`, `dev`, `check`, `test`, `bench`.

- [ ] **Step 1: package.json**

```json
{
  "name": "wal-observer",
  "private": true,
  "type": "module",
  "scripts": {
    "wal-observer": "vite build --logLevel warn && node scripts/wal-server.ts",
    "build": "vite build",
    "dev": "vite",
    "check": "tsc -p tsconfig.json && tsc -p web/tsconfig.json",
    "test": "vite build --logLevel warn && node --test scripts/*.test.ts web/src/lib/*.test.ts && bash hooks/wal-hook.test.sh",
    "bench": "node scripts/bench.ts"
  }
}
```

Then: `npm install -D typescript @types/node@24 vite @vitejs/plugin-react react react-dom @types/react @types/react-dom`

- [ ] **Step 2: tsconfig.json (server, hook, tests, shared, pure web logic, vite config)**

```json
{
  "compilerOptions": {
    "target": "es2023",
    "lib": ["es2023"],
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "types": ["node"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noEmit": true,
    "allowImportingTsExtensions": true,
    "erasableSyntaxOnly": true,
    "verbatimModuleSyntax": true,
    "skipLibCheck": true
  },
  "include": ["scripts", "hooks", "shared", "web/src/lib", "vite.config.ts"]
}
```

- [ ] **Step 3: web/tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "es2023",
    "lib": ["es2023", "dom", "dom.iterable"],
    "module": "esnext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "types": ["vite/client"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noEmit": true,
    "allowImportingTsExtensions": true,
    "erasableSyntaxOnly": true,
    "verbatimModuleSyntax": true,
    "skipLibCheck": true
  },
  "include": ["src", "../shared"],
  "exclude": ["src/**/*.test.ts"]
}
```

- [ ] **Step 4: shared/api.ts**

```ts
// Wire types shared by wal-server and the page; the server is the only producer.

export const CATEGORIES = ['tool', 'mcp', 'turn', 'session', 'attn', 'fail'] as const
export type Category = (typeof CATEGORIES)[number]
export type McpRole = 'request' | 'response'

export interface Row {
  seq: number
  cat: Category
  t: number
  event?: string
  tool: string | null
  dur: number | null
  sess: string | null
  mcp?: McpRole
  err?: true
  virtual?: { pre: number; post: number }
}

export interface Page {
  file: string
  gen: number
  head: number
  rows: Row[]
  next: number | null
}

// Only the first page of a query (no `before`) carries totals and facets.
export interface FirstPage extends Page {
  total: number
  counts: Partial<Record<Category, number>>
  tools: string[]
  sessions: string[]
}

export interface WalRecord {
  ts?: string
  event?: string
  payload?: Record<string, unknown>
  [key: string]: unknown
}

export interface McpCallRecord {
  virtual: true
  pre: WalRecord
  post: WalRecord
}

export type RecordResponse = WalRecord | McpCallRecord
```

- [ ] **Step 5: .gitignore** — append to the repo `.gitignore`:

```
/agents/plugins/wal-observer/node_modules/
/agents/plugins/wal-observer/web/dist/
```

- [ ] **Step 6: Verify**

Run: `npx tsc --version && npx tsc -p tsconfig.json && git status --short`
Expected: a 7.x version, no tsc errors (an empty-input error is acceptable only if TS reports "No inputs were found" — then proceed, Task 2 adds inputs); `node_modules` absent from `git status`. If TS 7 rejects any compiler option above, replace it with its documented TS 7 equivalent and note it in the commit body.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json tsconfig.json web/tsconfig.json shared/api.ts ../../../.gitignore
git commit -m "build(wal-observer): add TypeScript/Vite toolchain and shared API types"
```

---

### Task 2: Server and its tests in TypeScript

**Files:**
- Create: `scripts/wal-server.ts`, `scripts/query.test.ts`, `scripts/live-tail.test.ts`, `scripts/bench.ts`
- Delete: `scripts/wal-server.mjs`, `scripts/query.test.mjs`, `scripts/live-tail.test.mjs`, `scripts/bench.mjs` (`git rm`)

**Interfaces:**
- Consumes: `shared/api.ts` (`Row`, `Page`, `FirstPage`, `WalRecord`, `RecordResponse`, `Category`).
- Produces: `node scripts/wal-server.ts [--port=N] [--file=PATH]` with the same stdout lines (`wal viewer:  http://127.0.0.1:<port>`, `watching:    <file>`, optional note), the same endpoints `/events`, `/record`, `/stream`, plus static files from `web/dist` (`/` → `web/dist/index.html`).

- [ ] **Step 1: Port the tests first (they must fail)**

`git mv scripts/query.test.mjs scripts/query.test.ts` (same for `live-tail.test`, `bench`). In each: change the spawned file `wal-server.mjs` → `wal-server.ts`, add types (helper signatures such as `const check = (label: string, ok: boolean, detail = ''): void`, `events` returning `Promise<FirstPage>`, SSE frame parsing typed as `Row[]`), keep every assertion and its label unchanged. They keep their own `check` harness and exit code; `node --test` treats a non-zero exit as a failed file, so no rewrite into `test()` blocks.

Add to `query.test.ts`, next to the other endpoint checks, the static-path guard:

```ts
const status = async (path: string) => (await fetch(`${BASE}${path}`)).status
check('static: encoded traversal is refused', (await status('/%2e%2e/package.json')) === 404)
check('static: malformed escape is refused', (await status('/%E0%A4%A')) === 404)
check('static: unknown file is 404', (await status('/nope.js')) === 404)
```

Add a "missing file" block at the end of `query.test.ts` (before the final summary), with its own server on a path that does not exist yet:

```ts
const lateWal = join(dir, 'late.jsonl')
const LPORT = PORT + 200
const late = spawn('node', [join(HERE, 'wal-server.ts'), `--port=${LPORT}`, `--file=${lateWal}`], {
  stdio: 'ignore',
  env: { ...process.env, TZ: 'UTC' },
})
try {
  const empty = await until(() => events('', `http://127.0.0.1:${LPORT}`))
  check('missing file: /events answers with nothing', empty.total === 0 && empty.head === 0 && empty.rows.length === 0, JSON.stringify(empty))
  writeFileSync(lateWal, JSON.stringify({ ts: '2026-09-30T10:00:00.000Z', event: 'SessionStart', session_id: 'z' }) + '\n')
  const first = await events('', `http://127.0.0.1:${LPORT}`)
  check('missing file: a file created later is picked up', first.total === 1 && first.rows[0]?.event === 'SessionStart', JSON.stringify(first))
} finally {
  late.kill()
}
```

- [ ] **Step 2: Run to see them fail**

Run: `node --test scripts/query.test.ts`
Expected: FAIL (the spawned `wal-server.ts` does not exist; the harness times out).

- [ ] **Step 3: Port the server**

`git mv scripts/wal-server.mjs scripts/wal-server.ts`, then add types throughout without changing logic: an `IndexEntry` interface (`off, len, t, day, minute, event, cat, tool, dur, sess, tuid, mcp, err, virtual` — all keys always present, the existing "one hidden class" comment stays), `Row` for `summary()`, `Page`/`FirstPage` for `query()`, `(r: IndexEntry, text: (r: IndexEntry) => string) => boolean` for the matcher, a `Client` interface for SSE clients. Replace the `/` handler that streams `PAGE` with static serving:

```ts
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { extname, resolve, sep } from 'node:path'

const WEB = resolve(HERE, '..', 'web', 'dist')
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.map': 'application/json',
}

// Only files under web/dist are served: the URL is decoded first, so `%2e%2e` cannot climb out.
const serveStatic = (pathname: string, res: ServerResponse): boolean => {
  let rel: string
  try {
    rel = decodeURIComponent(pathname === '/' ? '/index.html' : pathname)
  } catch {
    return false
  }
  const file = resolve(WEB, '.' + rel)
  if (!file.startsWith(WEB + sep) || !existsSync(file) || !statSync(file).isFile()) return false
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' })
  createReadStream(file).pipe(res)
  return true
}
```

In `handle`, after the API routes and before the final 404:

```ts
  if (serveStatic(url.pathname, res)) return
  if (url.pathname === '/') return void res.writeHead(503).end('page not built: run `npm run build`')
```

Remove the now-unused `PAGE` constant.

- [ ] **Step 4: Run tests**

Run: `npx tsc -p tsconfig.json && node --test scripts/query.test.ts scripts/live-tail.test.ts`
Expected: no type errors; both files pass, their output ending `all checks passed`.

- [ ] **Step 5: Bench budgets**

Run: `node scripts/bench.ts`
Expected: all budgets reported ok (first page < 300 ms, text search < 3 s, deep page < 300 ms, RSS < 300 MB).

- [ ] **Step 6: Commit**

```bash
git add -A scripts
git commit -m "refactor(wal-observer): port server, tests and bench to TypeScript"
```

---

### Task 3: Hook in TypeScript

**Files:**
- Create: `hooks/wal-hook.ts` (`git mv hooks/wal-hook.mjs hooks/wal-hook.ts`)
- Modify: `hooks/hooks.json` (31 commands), `hooks/wal-hook.test.sh`

**Interfaces:**
- Produces: `node "${CLAUDE_PLUGIN_ROOT}/hooks/wal-hook.ts"` reading one hook payload on stdin, appending one line to `<CLAUDE_PROJECT_DIR or cwd>/.ai/logs/wal.jsonl`.

- [ ] **Step 1: Baseline start-up time (before the port)**

```bash
d=$(mktemp -d); time (for i in $(seq 20); do printf '{"hook_event_name":"Stop","session_id":"s"}' | CLAUDE_PROJECT_DIR=$d node hooks/wal-hook.mjs; done)
```

Record the `real` figure in the commit body.

- [ ] **Step 2: Point the test at the .ts file (it must fail)**

In `hooks/wal-hook.test.sh`: `hook="$here/wal-hook.ts"` and the header comment `wal-hook.mjs` → `wal-hook.ts`.
Run: `bash hooks/wal-hook.test.sh`
Expected: FAIL (file missing).

- [ ] **Step 3: Port**

`git mv hooks/wal-hook.mjs hooks/wal-hook.ts`; update the header comment name; type `clamp(value: unknown, depth = 0): unknown`, `record` as `Record<string, unknown> & { ts: string; event?: string }`, `parsed` as `Record<string, unknown> | null`, `readStdin(): Promise<string>`. No other change. Then:

```bash
sed -i 's#hooks/wal-hook.mjs#hooks/wal-hook.ts#g' hooks/hooks.json
grep -c 'wal-hook.ts' hooks/hooks.json   # expect 31
grep -c 'wal-hook.mjs' hooks/hooks.json  # expect 0
```

- [ ] **Step 4: Verify**

Run: `npx tsc -p tsconfig.json && bash -n hooks/wal-hook.test.sh && shellcheck hooks/wal-hook.test.sh && bash hooks/wal-hook.test.sh`
Expected: `all checks passed`.
Then repeat Step 1's timing with `hooks/wal-hook.ts`. Expected: within +30 ms per call of the baseline on average (20 calls: `real` ≤ baseline + 0.6 s). If over, report the numbers instead of committing.

- [ ] **Step 5: Commit**

```bash
git add -A hooks
git commit -m "refactor(wal-observer): port the WAL hook to TypeScript"
```

---

### Task 4: Pure page logic in `web/src/lib` with unit tests

**Files:**
- Create: `web/src/lib/categories.ts`, `web/src/lib/mcp.ts`, `web/src/lib/params.ts`, `web/src/lib/format.ts`, `web/src/lib/normalize.ts`, `web/src/lib/tree.ts`
- Test: `web/src/lib/mcp.test.ts`, `web/src/lib/params.test.ts`, `web/src/lib/tree.test.ts`

**Interfaces:**
- Consumes: `Category`, `CATEGORIES` from `../../../shared/api.ts`.
- Produces:
  - `categories.ts`: `CATEGORY: Record<Category, { label: string; color: string; glyph?: '!' }>` (values copied from the page's `CATEGORY`).
  - `mcp.ts`: `mcpParts(t: string): [server: string, tool: string] | null`, `hue(s: string): number`, `toolColor(t: string): string` (`'-'` = no tool), `groupMcp(tools: readonly string[], q: string): { server: string; tools: string[] }[]`.
  - `params.ts`: `interface Filters { q: string; session: string; date_from: string; date_to: string; time_from: string; time_to: string; min_ms: string; max_ms: string; cat: ReadonlySet<Category>; tool: ReadonlySet<string>; nodur: boolean }`, `EMPTY_FILTERS: Filters`, `buildParams(f: Filters): URLSearchParams`.
  - `format.ts`: `fmtDate(t: number): string`, `fmtTime(t: number): string`, `short(s: string | null): string`.
  - `normalize.ts`: `normalize(v: unknown): unknown`.
  - `tree.ts`: `type Seg = readonly ['p' | 'k' | 's' | 'n' | 'b', string]`, `type Line = Seg[]`, `interface Group { h: Seg[]; o?: Seg; k: TreeNode[]; c?: Seg[]; s: string }`, `type TreeNode = Line | Group`, `type Format = 'json' | 'yaml' | 'raw'`, `FORMATS: readonly Format[]`, `pretty(v: unknown): string`, `viewNodes(v: unknown, yaml: boolean): TreeNode[]` (normalizes, unwraps a YAML root mapping/sequence), `copyText(v: unknown, format: Format): string`.

Port each function from `scripts/index.html` at `d049c79` (`git show d049c79:agents/plugins/wal-observer/scripts/index.html`): `CATEGORY`, `mcpParts`, `hue`, `toolColor`, the grouping/filtering inside `renderMcp`, `params`, `pad`/`fmtDate`/`fmtTime`/`short`, `isBlock`/`normalize`, `YQ`/`yq`/`P`/`scalar`/`tree`/`line`/`text`, and from `pane()` the root-unwrap + trailing-newline + Raw logic (`copyText`). Keep their comments. No DOM in `lib/`.

- [ ] **Step 1: Write the failing tests**

`web/src/lib/mcp.test.ts`:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { groupMcp, mcpParts, toolColor } from './mcp.ts'

test('mcpParts splits server and tool at the first __ after the prefix', () => {
  assert.deepEqual(mcpParts('mcp__claude_ai_Todoist__find-tasks'), ['claude_ai_Todoist', 'find-tasks'])
  assert.deepEqual(mcpParts('mcp__x'), ['x', 'x'])
  assert.equal(mcpParts('Bash'), null)
})

test('colours: no tool red, built-ins Claude orange, MCP stable per server', () => {
  assert.equal(toolColor('-'), 'var(--status-critical)')
  assert.equal(toolColor('Bash'), 'var(--tool-claude)')
  assert.equal(toolColor('mcp__pg__query'), toolColor('mcp__pg__exec'))
  assert.match(toolColor('mcp__pg__query'), /^hsl\(\d+ 60% 55%\)$/)
})

test('groupMcp sorts groups and tools, search matches server or tool name', () => {
  const tools = ['Bash', 'mcp__pg__query', 'mcp__idea__open', 'mcp__pg__exec', 'mcp__idea__close']
  assert.deepEqual(groupMcp(tools, ''), [
    { server: 'idea', tools: ['mcp__idea__close', 'mcp__idea__open'] },
    { server: 'pg', tools: ['mcp__pg__exec', 'mcp__pg__query'] },
  ])
  assert.deepEqual(groupMcp(tools, 'PG'), [{ server: 'pg', tools: ['mcp__pg__exec', 'mcp__pg__query'] }])
  assert.deepEqual(groupMcp(tools, 'clo'), [{ server: 'idea', tools: ['mcp__idea__close'] }])
})
```

`web/src/lib/params.test.ts`:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EMPTY_FILTERS, buildParams } from './params.ts'

test('nothing selected sends no filter at all', () => {
  assert.equal(buildParams(EMPTY_FILTERS).toString(), '')
})

test('selected chips become include lists; text fields are trimmed; nodur only when on', () => {
  const p = buildParams({
    ...EMPTY_FILTERS,
    q: '  needle ',
    min_ms: '10',
    cat: new Set(['fail'] as const),
    tool: new Set(['Bash', '-']),
    nodur: true,
  })
  assert.equal(p.toString(), 'q=needle&min_ms=10&cat=fail&tool=Bash%2C-&nodur=include')
})
```

`web/src/lib/tree.test.ts`:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { copyText, viewNodes } from './tree.ts'
import { normalize } from './normalize.ts'

const yaml = (v: unknown) => copyText(v, 'yaml')

test('JSON copy equals JSON.stringify of the normalized value', () => {
  for (const v of [[{ a: 1 }, { b: 2 }], {}, [], { a: {} }, { s: 'x\ny', n: -0, b: false, z: null }]) {
    assert.equal(copyText(v, 'json'), JSON.stringify(normalize(v), null, 2))
  }
})

test('YAML: single-key list items stay on the dash line', () => {
  assert.equal(yaml([{ a: 1 }, { b: 2 }]), '- a: 1\n- b: 2\n')
  assert.equal(yaml({ rows: [{ id: 1, name: 'a' }], count: 1 }), 'rows:\n  - id: 1\n    name: a\ncount: 1\n')
})

test('YAML: literal blocks for multi-line text, quotes where YAML needs them', () => {
  assert.equal(yaml('first line\nsecond: line\nthird line\n'), '|\n  first line\n  second: line\n  third line\n')
  assert.equal(yaml({ s: 'a\u0001\nb' }), 's: "a\\u0001\\nb"\n')
  assert.equal(yaml({ k: '<<' }), 'k: "<<"\n')
  assert.equal(yaml({ k: '=' }), 'k: "="\n')
  assert.equal(yaml({ k: 'a b' }), 'k: "a\\u2028b"\n')
  assert.equal(yaml({ k: 'yes' }), 'k: "yes"\n')
  assert.equal(yaml({ k: '1e3' }), 'k: "1e3"\n')
})

test('MCP content blocks are unwrapped and JSON strings parsed at any depth', () => {
  assert.deepEqual(normalize([{ type: 'text', text: '{"a":1}' }]), { a: 1 })
  assert.deepEqual(normalize([{ type: 'resource', resource: { text: '{"a":1}' } }]), [{ type: 'resource', resource: { text: { a: 1 } } }])
  assert.equal(normalize('12'), '12')
  assert.equal(normalize('{bad'), '{bad')
})

test('Raw copy is the stored value, pretty-printed, not normalized', () => {
  const v = [{ type: 'text', text: '{"a":1}' }]
  assert.equal(copyText(v, 'raw'), JSON.stringify(v, null, 2))
  assert.equal(copyText('plain', 'raw'), 'plain')
})

test('collapsed summaries use singular forms', () => {
  const [n] = viewNodes({ a: [1] }, false)
  assert.ok(n && !Array.isArray(n))
  assert.equal(n.s, '{…} 1 key')
})

test('a 1 MB string renders and copies quickly', () => {
  const big = { tool_response: 'x'.repeat(1_000_000) + '\n' + 'y'.repeat(1000) }
  const t0 = performance.now()
  viewNodes(big, true)
  copyText(big, 'yaml')
  assert.ok(performance.now() - t0 < 500)
})
```

- [ ] **Step 2: Run them to see them fail**

Run: `node --test web/src/lib/*.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement the six lib files** by porting the functions listed above with types, keeping semantics byte-for-byte (same regexes, same summaries, same ordering).

- [ ] **Step 4: Run tests**

Run: `npx tsc -p tsconfig.json && node --test web/src/lib/*.test.ts`
Expected: all pass. If a YAML expectation differs, the old page is the reference: evaluate the same input with the `d049c79` functions (extract them with `git show` into `/tmp/old.mjs`) and fix the port, not the test, unless the old page itself produces the listed output differently — then report it.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib
git commit -m "refactor(wal-observer): extract viewer logic into typed, tested lib modules"
```

---

### Task 5: React page

**Files:**
- Create: `vite.config.ts`, `web/index.html`, `web/src/main.tsx`, `web/src/App.tsx`, `web/src/styles.css`, `web/src/useStored.ts`, `web/src/useEvents.ts`, `web/src/components/{FilterBar,Chip,McpPanel,StatsHeader,EventTable,EventRow,RecordViewer,Tree}.tsx`
- Delete: `scripts/index.html` (`git rm`, after Step 5 passes)
- Modify: `scripts/query.test.ts` (built-page checks)

**Interfaces:**
- Consumes: everything from Task 4 and `shared/api.ts`.
- Produces: the built page in `web/dist/`, served by Task 2's static handler.

The old page (`git show d049c79:agents/plugins/wal-observer/scripts/index.html`) is the behaviour reference. Required behaviours — each must survive the port:

1. Filter edits (text, session, date/time, duration, chips, MCP checkboxes, nodur) re-query after a 250 ms debounce; each query bumps a generation and drops any response or page from an older one.
2. After a first page lands, a stream opens at `/stream?<same params>&after=<head>&gen=<gen>`; a `reset` event closes it and re-queries; stream rows bump `counts`/`total`/`head` and add unseen tools (unselected) and sessions.
3. Follow on + at the edge → live rows are shown and the view stays at the edge; otherwise they wait behind the pill (`↓ N new` in Tail at the bottom, `↑ N new` in Table under the bar); clicking the pill, or scrolling back to the edge with Follow on, flushes them.
4. Tail: oldest first, first page scrolled to the bottom, older pages prepended with the view anchored (scroll by the height added). Table: newest first, older pages appended. The sentinel sits above the table in Tail and below it in Table, is observed with `rootMargin: '300px'` and re-observed after every page.
5. `View: Tail|Table` button persisted in `wal.view`; switching re-queries.
6. Clicking a row toggles its detail; the first open fetches `/record?seq&gen`; 409 re-queries; an error shows the message and the next open retries. MCP call rows render Request | Response (or `Error`/`Error (interrupted)`, red) side by side; other rows one `Record` pane.
7. `Format: JSON | YAML | Raw` segmented control persisted in `wal.format`; open rows re-render on change without refetching; each pane has Copy (`Copied` / `Copy failed` for 1.2 s), copy text computed on click.
8. Category and tool chips are opt-in (none pressed = no filter), with colour dots and the selected tint; `(no tool)` first in the tools row; the no-duration chip is disabled unless a duration bound is set and reads `no duration: include|exclude`.
9. MCP calls pill hidden until the first `mcp__` tool; label `MCP calls` / `MCP calls · N`; `data-on` when N > 0; `aria-expanded`, no `aria-pressed`. Popover: search (narrows only), Select all / Deselect all over visible tools, groups sorted with dot + tri-state checkbox, tool checkboxes; Esc or an outside click closes; a tool arriving live while open appears unchecked with the search text kept.
10. Reset clears every input, both selections and nodur (the search text inside the MCP popover stays).
11. Hero = total; label `matching events · showing N · M recorded`; six category tiles; `No events match this filter.` when nothing shown or pending; `could not load events (…) · change a filter or click the status to retry` on a failed `/events`.
12. Live indicator dot + `live`/`disconnected`; clicking the text re-queries. Theme toggle flips `data-theme` on `<html>`.
13. Sticky filter bar; `--bar-h` kept in sync by a ResizeObserver so the table header sticks under it; `html { overflow-anchor: none }` kept.
14. Row cells: Date, Time (ms), Event (category dot, `!` glyph for attn/fail, name, badge `MCP req`/`MCP res` or the tool part after `__` on call rows, red when `err`), Tool (colour dot + name, `—` when none), Duration (`N ms`/`—`), Session (first 8 chars).

- [ ] **Step 1: Add the failing built-page check** to `scripts/query.test.ts` (next to the static checks from Task 2):

```ts
const home = await fetch(`${BASE}/`)
const html = await home.text()
check('static: / serves the built page', home.status === 200 && (home.headers.get('content-type') ?? '').startsWith('text/html') && html.includes('id="root"'), `${home.status}`)
const asset = /src="(\/assets\/[^"]+\.js)"/.exec(html)?.[1]
check('static: built script is served as JavaScript', !!asset && (await fetch(`${BASE}${asset}`)).headers.get('content-type')?.startsWith('text/javascript') === true, String(asset))
```

Run: `node --test scripts/query.test.ts` — Expected: FAIL on both (503 / no asset).

- [ ] **Step 2: vite.config.ts and the HTML shell**

```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The dev server proxies the API to a wal-server started separately on its default port.
const api = 'http://127.0.0.1:7878'

export default defineConfig({
  root: 'web',
  plugins: [react()],
  build: { outDir: 'dist', emptyOutDir: true },
  server: {
    fs: { allow: ['..'] },
    proxy: { '/events': api, '/record': api, '/stream': api },
  },
})
```

`web/index.html`:

```html
<!doctype html>
<html lang="en" data-theme="auto">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>WAL — Claude Code event log</title>
</head>
<body>
<div id="root"></div>
<script type="module" src="/src/main.tsx"></script>
</body>
</html>
```

- [ ] **Step 3: Components**

- `styles.css`: the old `<style>` block verbatim (same selectors/ids/classes, so the parity check can compare DOM text and computed colours).
- `useStored.ts`: `useStored<T extends string>(key: string, allowed: readonly T[], fallback: T): [T, (v: T) => void]` over `localStorage`.
- `useEvents.ts`: owns behaviours 1–3 and paging: `useEvents(filters: Filters, view: 'tail' | 'table')` returning `{ rows, pending, total, counts, head, gen, file, tools, sessions, live, error, next, loadOlder, flush, requery }`; debouncing, generation guard, EventSource lifecycle (closed on re-query and unmount).
- `EventTable.tsx`: renders rows in display order, the sentinel (IntersectionObserver) and the pill; does Tail anchoring in a `useLayoutEffect` that runs after an older page is prepended (`scrollBy(0, scrollHeight - heightBefore)`) and edge-following after live rows; `atEdge` exactly as the old page computes it.
- `EventRow.tsx`: the row cells (behaviour 14) plus the lazy detail (behaviour 6); holds its fetched record in state.
- `RecordViewer.tsx` + `Tree.tsx`: panes, Copy, `<details open>` nodes with the same class names (`tree`, `kids`, `sum`, `o`, `bad`, segment classes `p k s n b`).
- `FilterBar.tsx`, `Chip.tsx`, `McpPanel.tsx`, `StatsHeader.tsx`, `App.tsx`: behaviours 5, 7–13. Keep all element ids from the old page (`q`, `session`, `cats`, `tools`, `mcp`, `mcppill`, `mcplabel`, `mcppop`, `mcpq`, `mcplist`, `follow`, `view`, `format`, `livedot`, `livetext`, `date_from` … `max_ms`, `nodur`, `reset`, `hero`, `herolabel`, `tiles`, `table`, `rows`, `empty`, `pill`, `sentinel`, `theme`, `file`, `bar`) so the parity checklist addresses both pages the same way.

- [ ] **Step 4: Type-check and build**

Run: `npm run check && npm run build`
Expected: no errors; `web/dist/index.html` and `web/dist/assets/*.js` exist.

- [ ] **Step 5: Tests and a smoke run**

Run: `npm test`
Expected: every file passes, hook test prints `all checks passed`.
Smoke: `node scripts/wal-server.ts --port=7995 --file=/tmp/wal-viewer-test.jsonl` (create the log if missing: an `mcp__postgres__query` Pre/Post pair with the same `tool_use_id` whose `tool_response` is `[{"type":"text","text":"{\"rows\":[{\"id\":1,\"name\":\"a\"}],\"count\":1}"}]`, a Bash Pre/Post pair, a `UserPromptSubmit`). Open it with the Playwright MCP tools; check: rows render, a row expands to the JSON tree, the MCP pill appears, the console has no errors except `favicon.ico` 404. **Anchoring:** append 400 lines to the log, switch to Tail, scroll to the top so an older page loads, and assert (via `browser_evaluate`) that the first previously visible row's `getBoundingClientRect().top` moved by less than 2 px. Close the browser and stop the server.

- [ ] **Step 6: Remove the old page and commit**

```bash
git rm scripts/index.html
git add vite.config.ts web scripts/query.test.ts
git commit -m "refactor(wal-observer): rebuild the viewer page in React"
```

---

### Task 6: Parity check, old page vs new

**Files:**
- Create: `.ai/changes/wal-observer-ts-react/parity.md` (the report, repo root `.ai/`)

**Interfaces:**
- Consumes: the built page (Task 5); the old plugin at `d049c79`.

- [ ] **Step 1: Stage both servers on one crafted log**

```bash
old=$(mktemp -d) && git -C /home/mraczynski/.config/unix_conf archive d049c79 agents/plugins/wal-observer | tar -x -C "$old"
```

Log `/tmp/wal-parity.jsonl`, at least: 2 sessions; built-in tools (Bash, Read, Edit); events without a tool; MCP pairs from 3 servers (`postgres`, `idea`, `neula`) including one failure (`is_interrupt: true`) and one orphan Pre; a Post whose `tool_response` is a text block with multi-line plain text; one 1 MB `tool_response`; one unparseable line; 450 filler rows so paging happens; durations on some rows.
Start old: `node "$old/agents/plugins/wal-observer/scripts/wal-server.mjs" --port=7881 --file=/tmp/wal-parity.jsonl` (Node 24 runs `.mjs` fine). Start new: `node scripts/wal-server.ts --port=7882 --file=/tmp/wal-parity.jsonl`. Set `TZ=UTC` for both.

- [ ] **Step 2: Drive the same actions on both, compare**

For each action below, on both pages capture via `browser_evaluate`: the `/events` request URL of the last query (`performance.getEntriesByType('resource')`), `#hero` and `#herolabel` text, the text of the first 20 rows' cells, and where relevant the detail text / copied text. Actions: initial load (Tail); Table view; each category chip; `(no tool)` chip; Bash chip; MCP pill → search `pg` → Select all → Deselect all → group checkbox to partial via one tool → full; Reset; `q=needle`; date and time ranges; duration ≥ with nodur include/exclude; scroll to load older pages in both views; expand the postgres call in JSON, YAML, Raw and Copy each; expand the 1 MB row in YAML (record the time to render on both); expand the failure row; append 3 lines to the log and check the `N new` pill when scrolled away and auto-follow at the edge; truncate the log and check the reset.

- [ ] **Step 3: Write `parity.md`**: one table row per action — old value, new value, `same`/`DIFF`. Every `DIFF` gets fixed in the React code (then re-run that action) or, when the old behaviour was a bug, stays listed with a one-line reason for the user to decide.

- [ ] **Step 4: Verify**

Expected: every row `same`, or `DIFF` with an explicit reason. `npm test` still passes. Stop both servers, close the browser.

- [ ] **Step 5: Commit**

```bash
git add .ai/changes/wal-observer-ts-react/parity.md web
git commit -m "test(wal-observer): old vs new viewer parity report"
```

---

### Task 7: Launch through npm, install sync, docs

**Files:**
- Modify: `commands/wal.md`, `/home/mraczynski/.config/unix_conf/install.sh` (`sync_unix_conf_plugins`), `README.md`
- Check: `/home/mraczynski/.config/unix_conf/AGENTS.md` (only if it names a changed path)

**Interfaces:**
- Consumes: npm script `wal-observer` (Task 1).

- [ ] **Step 1: `/wal` command**

In `commands/wal.md`: frontmatter `allowed-tools: Bash(cd:*), Bash(npm:*), Bash(node:*), Bash(xdg-open:*)`; procedure step 1 becomes:

```markdown
1. Install, build and launch the server in the background so it outlives this turn. The WAL path is
   passed explicitly because the `cd` moves the working directory the server would otherwise use:

   `wal="$PWD/.ai/logs/wal.jsonl"; cd "${CLAUDE_PLUGIN_ROOT}" && npm install --no-audit --no-fund && npm run wal-observer -- --file="$wal" $ARGUMENTS`

   The first run on a host downloads the toolchain and takes longer.
```

Steps 2–3 unchanged.

- [ ] **Step 2: install.sh keeps runtime state in installed copies**

In `sync_unix_conf_plugins`, change the comparison and the refresh:

```bash
		elif diff -rq --exclude node_modules --exclude dist "$plugins_dir/$name" "$install_path" >/dev/null 2>&1; then
```

```bash
			# node_modules and built web/dist live only in the installed copy (created by /wal).
			rsync -a --delete --exclude node_modules --exclude /web/dist "$plugins_dir/$name/" "$install_path/"
```

Run: `bash -n install.sh && shellcheck install.sh` (repo root) — no new findings versus `git stash`-free baseline (compare `shellcheck` output before and after the edit).

- [ ] **Step 3: Prove install + sync on a scratch copy**

```bash
src=agents/plugins/wal-observer; dst=$(mktemp -d)/wal-observer
rsync -a --exclude node_modules --exclude /web/dist "$src/" "$dst/"
(cd "$dst" && npm install --no-audit --no-fund && npm run wal-observer -- --port=7996 --file=/tmp/wal-viewer-test.jsonl) &
for _ in $(seq 180); do curl -s -o /dev/null http://127.0.0.1:7996/ && break; sleep 1; done
curl -s -o /dev/null -w '%{http_code} %{content_type}\n' http://127.0.0.1:7996/
pkill -f 'wal-server.ts --port=7996'
rsync -a --delete --exclude node_modules --exclude /web/dist "$src/" "$dst/"
ls "$dst/node_modules" >/dev/null && ls "$dst/web/dist/index.html"
diff -rq --exclude node_modules --exclude dist "$src" "$dst" && echo "in sync"
```

Expected: `200 text/html; charset=utf-8`; after the re-sync `node_modules` and `web/dist/index.html` still exist; `in sync`.

- [ ] **Step 4: README**

Update `README.md`: the Viewing section's run line (`/wal` installs, builds and starts; direct run `npm install && npm run wal-observer -- --port=7878 --file=/path/to/wal.jsonl`); a short Development section (`npm run dev` against a running server, `npm run check`, `npm run build`; Node with type stripping is required — see `docs/zsh/startup.md`); Testing section names `npm test` (builds, runs `scripts/*.test.ts`, `web/src/lib/*.test.ts`, the hook test) and `npm run bench`, with the `.ts` file names. `grep -n 'wal-hook\|wal-server\|index.html' /home/mraczynski/.config/unix_conf/AGENTS.md` — update only if a hit names an old path.

- [ ] **Step 5: Full verification**

Run: `npm run check && npm test` (plugin root)
Expected: clean check; all test files pass; `all checks passed` from the hook test.

- [ ] **Step 6: Commit**

```bash
git add commands/wal.md README.md ../../../install.sh
git commit -m "feat(wal-observer): launch via npm install and build, keep installed runtime files on sync"
```

---

### Task 8: Go live on NEULA014 (user-run steps)

These change the running environment, so the user runs them; the executor prints them and waits.

- [ ] **Step 1:** User opens a new zsh (nvm node on PATH, done outside this plan in `config/zsh/config/35_paths.zsh`), confirms `node -p process.features.typescript` prints `strip`, and restarts Claude Code from that shell.
- [ ] **Step 2:** User runs `./install.sh` (repo root); expect `refreshed wal-observer`.
- [ ] **Step 3:** In the restarted session, after any tool call: `tail -1 .ai/logs/wal.jsonl | jq -r .event` shows a fresh event — the hook is recording.
- [ ] **Step 4:** `/wal` opens the new page; it lists the fresh events.
- [ ] **Step 5:** Update `.ai/changes/wal-observer-ts-react/change.md` status and add a Review section with the outcome; commit `docs(changes): wal-observer TS/React port landed`.
