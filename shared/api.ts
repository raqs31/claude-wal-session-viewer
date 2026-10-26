// Wire types shared by wal-server and the page; the server is the only producer.

export const CATEGORIES = ['tool', 'mcp', 'subagent', 'turn', 'session', 'attn', 'fail'] as const
export type Category = (typeof CATEGORIES)[number]
export type McpRole = 'request' | 'response'

// Also read by the page, to colour each event chip by its category.
const OF: Record<string, Category> = {
  PreToolUse: 'tool',
  PostToolUse: 'tool',
  PostToolBatch: 'tool',
  UserPromptSubmit: 'turn',
  UserPromptExpansion: 'turn',
  Stop: 'turn',
  PreCompact: 'turn',
  PostCompact: 'turn',
  MessageDisplay: 'turn',
  SubagentStart: 'subagent',
  SubagentStop: 'subagent',
  PermissionRequest: 'attn',
  'MCP call': 'mcp',
  'Tool call': 'tool',
  PermissionDenied: 'fail',
  PostToolUseFailure: 'fail',
  StopFailure: 'fail',
  Unparseable: 'fail',
}
export const catOf = (ev: string | undefined): Category => (ev !== undefined && Object.hasOwn(OF, ev) && OF[ev]) || 'session'

// How far a session's target is built: `done` is the WAL bytes it covers, `total` the WAL size, `stale` the
// reason the target stopped following its sources, or null.
export type Pipe = { done: number; total: number; stale: string | null }

// The data of an `event: stale` frame on /events-stream.
export interface StaleFrame {
  sess: string
  reason: string
}

// A row is identified by its session and its line number in that session's target (`seq`).
export interface Row {
  sess: string
  seq: number
  cat: Category
  t: number
  event?: string
  tool: string | null
  dur: number | null
  mcp?: McpRole
  err?: true
  // Seqs of the paired Pre and Post, in the same session.
  virtual?: { pre: number; post: number }
}

// `head` is a position vector `<sess>:<n>,…` (rows indexed per picked session), passed back to
// /events-stream as `after`; stream frame ids use the same format. `next` is an opaque cursor
// for `before`. `gens` changes for a session whose target was re-indexed. `unknown`
// lists picked ids with no transcript (deleted, or newer than the last /sessions), skipped rather
// than failing the pick; every stream (/events-stream, /session-stream, /usage-stream) instead
// opens with an `event: unknown` frame whose data is that array, sent only when it is non-empty.
export interface Page {
  gens: Record<string, number>
  head: string
  rows: Row[]
  next: string | null
  unknown: string[]
}

// One session's agents as a tree: `main` (type null) at the root, each subagent under the agent
// whose `Agent` call spawned it (main when unknown). That link comes from the call's PostToolUse,
// which for a foreground spawn lands only when the child ends: no hook record names a running
// child's spawner, so until then it sits under main. `summaries` counts the progress summaries
// (subagents with no type on any record) describing that agent; main's count holds those naming
// no single subagent. The `agent` param addresses nodes per session: `<sess>:*` (or `main*`),
// `<sess>:<id>` (own rows), `<sess>:<id>*` (subtree), `<sess>:summaries:<id>`, with `main` as an id.
export interface AgentNode {
  id: string
  type: string | null
  summaries: number
  children: AgentNode[]
}

export interface SessionAgents {
  sess: string
  main: AgentNode
}

// Only the first page of a query (no `before`) carries totals and facets.
export interface FirstPage extends Page {
  total: number
  counts: Partial<Record<Category, number>>
  // Per picked session with a matching row: its first and last matching `t`. Bounds rather than a
  // summed length, so stream rows can widen them the way they add to `total`.
  spans: Record<string, [number, number]>
  tools: string[]
  events: string[]
  // Categories of every row in the pick, independent of the filter, in CATEGORIES order.
  cats: Category[]
  // One per picked session that holds any row, independent of the filter.
  agents: SessionAgents[]
  // Picked sessions whose WAL holds any row.
  sessions: string[]
  // One per picked session that discovery found.
  pipe: Record<string, Pipe>
}

export interface WalRecord {
  ts?: string
  event?: string
  payload?: Record<string, unknown>
  [key: string]: unknown
}

// A target `call` line as /record returns it.
export interface CallRecord {
  k: 'call'
  tuid: string
  t: number
  end: number
  dur: number | null
  tool: string | null
  mcp: boolean
  err: boolean
  agent: string | null
  agentType: string | null
  input: unknown
  response: unknown
}

export interface McpCallRecord {
  virtual: true
  pre: WalRecord
  post: WalRecord
  call: CallRecord
}

// A call row with no Pre or Post `ev`, as in a session without a WAL.
export interface CallOnlyRecord {
  // Never set; lets the page read `virtual` on any RecordResponse without a cast.
  virtual?: undefined
  call: CallRecord
}

export type RecordResponse = WalRecord | McpCallRecord | CallOnlyRecord

// ---- Sessions tab ----

export interface Source {
  label: string
  // Realpath; two sources sharing one are listed once, under the first label.
  projectsDir: string
}

export interface SessionMeta {
  id: string
  // `slug` is the parent project's for a worktree session; `cwd` is the transcript's first.
  project: { slug: string; cwd: string | null }
  worktree: string | null
  source: string
  // Every workspace that wrote to the session's WAL; ['unknown'] when none did.
  workspaces: string[]
  // The session's name: the latest /rename (`custom-title`), else the latest auto title (`ai-title`), else `prompt`.
  title: string
  // The first user message that started a turn, cleaned (system/command-output blocks dropped, other tags
  // stripped, a slash command or skill as `⚡ /name args`), newlines kept, cut to PROMPT_MAX chars plus '…';
  // null when none is in the head or nothing is left after cleaning.
  prompt: string | null
  started: number | null
  // Newest mtime of the transcript and the WAL.
  last: number
  live: boolean
  // `live`, or a WAL not ended with `last` in the past 24 h: a session idle at the prompt is still
  // open in Claude, which would recreate its files after a trash. Without a WAL, equal to `live`.
  busy: boolean
  walSize: number
  // Complete lines, the unit of the page's unseen badge.
  walLines: number
  transcriptSize: number
}

export interface SessionList {
  sources: Source[]
  sessions: SessionMeta[]
  // Pre-per-session `<cwd>/.ai/logs/wal.jsonl` files still on disk.
  legacy: number
}

export type Scope = 'all' | 'main' | `agent:${string}`

// Thinking is a subset of output: shown on its own, never added to a total.
export interface Usage {
  input: number
  output: number
  cacheRead: number
  cacheWrite5m: number
  cacheWrite1h: number
  thinking: number
}

export interface StatRow extends Usage {
  requests: number
  cost: number | null
}

export interface SessionStats {
  totals: StatRow
  agents: Record<string, StatRow>
  models: Record<string, StatRow>
  turns: number
  duration: number
}

// Columnar for uPlot: `t` and every token column share an index, one entry per request.
export interface SessionSeries {
  t: number[]
  cumulative: Record<AdditiveKey, number[]>
  perTurn: Record<AdditiveKey, number[]>
  turnStarts: number[]
  // The scope's own transcript: main's for `all` and `main`, the agent's for `agent:<id>`.
  compacts: Compact[]
}
export interface Compact {
  t: number
  trigger: string
  pre: number
  post: number
}
export type AdditiveKey = Exclude<keyof Usage, 'thinking'>

export interface AgentInfo {
  id: string
  type: string
  description: string
  model: string
  // The prompt the subagent was spawned with; null until its transcript holds it.
  prompt: string | null
  // The subagent whose Agent call spawned this one; null for main (or a spawner not read yet).
  parent: string | null
}

// `tools`: tool and Agent calls made; `duration`: last − first request, 0 below two requests;
// `context`: the prompt of the last request (input + cache read + cache write), 0 before the first.
export interface AgentStat {
  tools: number
  duration: number
  context: number
  // The agent's own transcript only; a session-wide view does not add its subagents' to main.
  compacts: Compact[]
}

export type RecordedCost = { total: number; models: Record<string, number> } | null

// /session, and each /session-stream frame (one per session whose `version` moved). `version` is the
// target offset of the last stats record the store read, and it moves when the target turns stale; it is
// not unique across re-opens. Pass `since=<id>:<version>,…`; the Last-Event-ID carries the same vector.
export interface SessionView {
  id: string
  gen: number
  version: number
  scope: Scope
  stats: SessionStats
  series: SessionSeries
  agents: AgentInfo[]
  // Keyed like `stats.agents`, plus agents in scope that made no request yet.
  agentStats: Record<string, AgentStat>
  recordedCostUsd: RecordedCost
  pipe: Pipe
}

// /usage and each /usage-stream frame, summed over the pick. `totals.cost` is null when any
// picked session used an unpriced model; `recorded` sums the sessions that recorded a cost,
// null only when none did, and `missing` counts those that did not. `unknown`: picked ids
// skipped for having no transcript, as on Page.
export interface UsageTotals {
  totals: StatRow
  recorded: number | null
  missing: number
  unknown: string[]
  pipe: Record<string, Pipe>
}

// ---- Trash ----

export interface TrashRef {
  source: string
  date: string
  slug: string
  id: string
}

// `title` and `cwd` are read from the trashed transcript the way discovery reads them.
export interface TrashEntry extends TrashRef {
  title: string
  cwd: string | null
  size: number
}

export interface TrashResult {
  id: string
  status: 'ok' | 'live' | 'conflict' | 'unknown' | 'failed'
  reason?: string
}
