# WAL viewer — filter side panel and sticky Events head Implementation Plan

## Overview

Move the Events-tab filters from the sticky bar at the top of the page into a right side panel that
behaves like the left session Sidebar (pinned = always shown, unpinned = slides in on demand). Both
panels share one `SidePanel` component, which replaces the `Pin`/`Unpin` text badge with a small
arrow button in the panel corner. With the filters gone from the top, the Events head (usage tiles
plus one merged events line) becomes the sticky block above the event list.

## Current State Analysis

- **Layout** (`web/src/App.tsx:43-65`): `div.viz-root[data-pin]` → `<Sidebar>` (fixed) + `div.main`
  holding `header`, `UsageTiles`, `LegacyBanner`, then the tab. The window is the only scroll
  container; Events' tail mode, infinite load and live follow all rely on it
  (`EventTable.tsx:31-66`, `styles.css:152,175`).
- **Left Sidebar pin/hover** (`Sidebar.tsx:38-39,148-160`): `wal.pin` (`useStored`, default
  `pinned`) lives in App; transient `open` is local to Sidebar. Unpinned, a 6px full-height
  `.sb-edge` strip opens it on `pointerenter`; the aside closes on `pointerleave`. CSS
  (`styles.css:175-183`) slides it with `transform` and flips `visibility`, `:focus-within` keeps it
  shown, and pinned only adds `margin-left: var(--sb-w)` on `.main` (`:46`). The prompt tooltip is
  portaled outside the aside and calls `setOpen(true)` on focus (`Sidebar.tsx:217`), so `open` must
  stay reachable from Sidebar code. The `place()` tooltip positioning reads the aside's rect via
  `asideRef` (`:77-91`).
- **Filter bar** (`FilterBar.tsx`, mounted at `EventsTab.tsx:40`): a horizontal sticky `.bar`
  (`styles.css:62`) with a fold (`wal.filters`), search, category chips, `AgentPicker`, the
  non-filter controls (Live, View, `FormatSeg`, live dot/requery text), and folded rows for tools
  (`McpPanel`), event names, date/time/duration, `nodur` and Reset. Reset remounts the text inputs
  through a `resets` key counter (`:62-64,130`). A `ResizeObserver` publishes the bar's height as
  `--bar-h` (`:55-60`), which the sticky `thead` (`styles.css:109`) and the table-mode pill (`:149`)
  use as their top offset. Filter values live in App state (`App.tsx:31`), not in the URL or
  storage — a prior decision (`.ai/archive/2026-09-29-wal-viewer-query/plan.md:65`).
- **Events head** (`StatsHeader.tsx`): a 52px `.hero` total, a `.hero-label` line
  (`matching events · showing N · M recorded`) and a row of per-category count tiles. There is no
  "per call" line; the user confirmed the merge target is the total plus the category tiles.
- **Usage tiles** (`UsageTiles.tsx`): input, output, cache, costs and live status over the pick,
  rendered globally in `.main` above both tabs, not sticky.
- **Pickers**: `AgentPicker` and `McpPanel` open absolutely positioned `.pop` dialogs
  (`styles.css:85-88`, min-width 300px) with document click-outside and Escape handlers.
- **Tests**: no DOM/component tests; `npm run check` (tsc on server and page) and `npm test`
  (vite build + `node --test` on `scripts/*.test.ts`, `web/src/lib/*.test.ts` + hook test).

## Desired End State

- Both panels render through one `SidePanel`. Each has a small arrow button in its inner top corner
  that pins/unpins it; the arrow points toward the outer edge when pinned ("hide") and toward the
  content when unpinned ("keep shown").
- Left Sidebar: same behaviour as today (default pinned, full-height left-edge strip reveals it), only
  the badge is replaced by the arrow.
- Right filter panel, Events tab only: default unpinned. A small "Filters" handle near the top of the
  right edge (not full height, so it never sits over the window scrollbar) opens it on hover or
  click and shows the active-filter count. Pinned, it reserves its width on `.main`. Its state is
  persisted under `wal.fpin`. All filters are stacked vertically; there is no fold.
- Events head is sticky: the usage tiles row, then one line holding the event total, the
  "matching · showing · recorded" label, the per-category counts, the active-filter summary with
  Reset (only when a filter is active), and the Live / View / Format controls with the events
  live dot. The table header and the table-mode pill sit under it.
- Sessions tab: usage tiles at the top as today (not sticky); no right panel, no right margin.
- README "The page" section describes the new layout.

### Key Discoveries:

- `open` must stay controllable by the caller: the Sidebar tooltip opens the panel from outside the
  aside's DOM (`Sidebar.tsx:217`).
- `--bar-h` is the single sticky offset for `thead` and `.pill.table`; it must move with the sticky
  block, or the table header slides under it.
- `.pop` dialogs are absolutely positioned; inside a scrolling panel (`overflow-y: auto`) they would
  be clipped, so in the panel they must flow inline.
- `FormatSeg` is exported from `FilterBar.tsx` but used only there (`FilterBar.tsx:24,101`).
- The shadow rule for an open unpinned sidebar keys off `.viz-root[data-pin]` (`styles.css:182`) — a
  shared panel needs its own pinned marker instead.

## What We're NOT Doing

- No change to filter semantics, `lib/params.ts`, facets, pruning, or the server/API.
- Filter values stay unpersisted (prior decision); only `wal.fpin` is new in storage.
- No inner scroll container: the window keeps the one scroll the Events tail logic relies on.
- No Escape-to-close for the panels (not present today).
- The left panel keeps its full-height edge strip; it gets no handle.
- No responsive auto-pin by screen width.
- Sidebar-specific content (tabs, picked chips, session filters, rows, tooltip) is not restructured.
- The obsolete `wal.filters` localStorage key is not cleaned from existing browsers.

## Implementation Approach

Extract the panel chrome first and prove it on the existing left Sidebar (no behaviour change except
the arrow), so phase 2 only adds a second instance. Then move the filters into a right
`SidePanel`, while the sticky `.bar` temporarily keeps only the view controls so the page stays
usable. Last, rebuild the sticky Events head around the usage tiles and the merged line and move
`--bar-h` to it.

## Critical Implementation Details

- **Reset across two places**: Reset is reachable from the panel and from the sticky line, and both
  must clear `badInput` fields by remounting them. Lift the `resets` counter out of the filter
  component into `EventsTab` and pass it down as the input key suffix.
- **Hidden panel, focus**: `visibility: hidden` must stay on the slid-out panel so its controls leave
  the tab order. Clicking or pressing Enter on the right handle opens the panel and moves focus to its
  arrow button; `:focus-within` then keeps it shown while the user tabs through the filters.

## Phase 1: Shared SidePanel with arrow toggle

### Overview

Introduce `SidePanel` and move the left Sidebar onto it. The visible change is the arrow replacing
the `Pin`/`Unpin` badge.

### Changes Required:

#### 1. SidePanel component

**File**: `tools/wal-observer/web/src/components/SidePanel.tsx` (new)

**Intent**: Own the panel chrome both sides share: the fixed `<aside>`, the reveal trigger, slide/
visibility state attributes, pointer-leave close when unpinned, and the corner arrow button.

**Contract**:
- Props: `side: 'left' | 'right'`, `label` (aria-label), `pinned`, `onPin`, `open`, `setOpen`
  (controlled by the caller), optional `handle?: ReactNode`, optional `asideRef`, optional
  `className` (for sidebar-specific layout), `children`.
- Reveal trigger, rendered only when `!pinned && !open`: without `handle`, the full-height edge
  strip on `side`; with `handle`, a small fixed `button.panel-handle` holding `handle`, which opens on
  `pointerenter` and on click (click also focuses the arrow button).
- `<aside class="panel" data-side={side} data-open={pinned || open || undefined}
  data-pinned={pinned || undefined}>`; `onPointerLeave` closes only when unpinned.
- Arrow: `button.panel-pin` with `aria-pressed={pinned}`, an `aria-label`/`title` saying what a click
  does (e.g. "Unpin: hide until the pointer reaches the left edge" / "Pin: keep shown"; the right
  panel's wording names the handle). Glyph: left `«` pinned / `»` unpinned, right `»` pinned / `«`
  unpinned.

#### 2. Sidebar adopts SidePanel

**File**: `tools/wal-observer/web/src/components/Sidebar.tsx`

**Intent**: Replace the hand-rolled `.sb-edge` strip, the `<aside>` attributes and the pin button
with `SidePanel side="left"`; keep the `open` state, `asideRef`, tooltip and all content as they are.

**Contract**: Sidebar still takes `pinned`/`onPin` from App; passes `open`/`setOpen`/`asideRef`
through. The `.sb-h` row keeps only the tabs and leaves room for the corner arrow.

#### 3. Panel CSS

**File**: `tools/wal-observer/web/src/styles.css`

**Intent**: Generalise the sidebar slide rules (`:175-183,189`) into `.panel` rules keyed by
`data-side` and `data-pinned`, keeping the visibility/transition trick and its comments. Keep the
`.sidebar` flex-column layout on the sidebar's own class.

**Contract**:
- `.panel[data-side=left]` slides on `translateX(-100%)` with a right border.
- `.panel[data-side=right]` slides on `translateX(100%)` with a left border.
- Each has a width variable: `--sb-w` (left, 300px) and a new `--fp-w` (right, 320px).
- The open-unpinned shadow keys off `.panel[data-open]:not([data-pinned])` and is mirrored per side.
- `.panel-pin` sits absolutely in the inner top corner.
- `.panel-edge` replaces `.sb-edge`.
- `.panel-handle` is a small fixed tab at the right edge near the top, `z-index` 6.

### Success Criteria:

#### Automated Verification:

- Type checks pass: `cd tools/wal-observer && npm run check`
- Build and tests pass: `cd tools/wal-observer && npm test`
- No leftover pin badge: `grep -rn "ghost pin\|sb-edge" tools/wal-observer/web/src` returns nothing

#### Manual Verification:

- Left sidebar pinned: arrow `«` in its corner; clicking it unpins and the sidebar slides out, `.main`
  loses its left margin; the choice survives a reload.
- Unpinned: the left-edge strip slides it in, leaving closes it, the arrow shows `»` and pins it.
- The session prompt tooltip still opens beside the sidebar and focusing it keeps the unpinned
  sidebar open.
- Tabbing never reaches controls of the slid-out sidebar.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Right filter panel

### Overview

The filters move from the top bar into a right `SidePanel` on the Events tab; the top bar keeps only
the view controls until phase 3.

### Changes Required:

#### 1. FilterBar becomes FilterPanel

**File**: `tools/wal-observer/web/src/components/FilterBar.tsx` → `FilterPanel.tsx` (`git mv`)

**Intent**: Render only the filters, stacked vertically, with no fold: search, category chips, agent
picker, tool chips (with `McpPanel`), event-name chips, date, time, duration, `nodur`, Reset. Drop
the view controls, the `wal.filters` fold and the `ResizeObserver`; they move to `EventsTab`.

**Contract**:
- Props: `filters`, `setFilters`, `tools`, `events`, `cats`, `agents`, `resets: number`,
  `onReset: () => void`.
- Each section gets a small heading (Search, Category, Agent, Tool, Event, Date, Time, Duration).
- Text inputs keep their `key={`${id}${resets}`}` remount.
- `FormatSeg` moves out with the view controls.

#### 2. EventsTab hosts the right panel and the remaining bar

**File**: `tools/wal-observer/web/src/components/EventsTab.tsx`

**Intent**: Mount `SidePanel side="right" label="Filters"` around `FilterPanel`. Hold the panel's
`open` state, the `resets` counter and `reset()`. Keep a sticky `.bar` holding the moved Live / View
/ `FormatSeg` / live-dot controls and the `--bar-h` `ResizeObserver` (moved from FilterBar), so
sticky offsets keep working.

**Contract**:
- The handle content is `Filters` plus a count badge when `filterSummary(filters, tree).length > 0`.
- The panel's `pinned`/`onPin` come from App.
- `reset()` = `setFilters({ ...EMPTY_FILTERS })` and bump `resets`.

#### 3. App: right pin state

**File**: `tools/wal-observer/web/src/App.tsx`

**Intent**: Persist the right panel's pin state and reserve its width only while the Events tab is
shown.

**Contract**:
- `useStored('wal.fpin', PINS, 'unpinned')`, passed to `EventsTab` as `fpinned`/`onFpin`.
- `div.viz-root` gets `data-fpin={fpin}` only when the Events tab is mounted.

#### 4. Panel and filter CSS

**File**: `tools/wal-observer/web/src/styles.css`

**Intent**: Lay out the filter stack inside the panel and keep pickers usable in a narrow, scrolling
panel.

**Contract**:
- `.viz-root[data-fpin="pinned"] .main { margin-right: var(--fp-w) }`.
- The filter panel scrolls its body (`overflow-y: auto`, `min-height: 0`).
- `input[type=search]` inside it is full width (`min-width: 0`).
- `.mcp`/`.dd` wrappers are block-level, and `.pop` inside the panel is `position: static; min-width: 0`,
  so the pickers expand inline instead of being clipped.
- The `.bar` comment is updated to say what now sticks.

### Success Criteria:

#### Automated Verification:

- Type checks pass: `cd tools/wal-observer && npm run check`
- Build and tests pass: `cd tools/wal-observer && npm test`
- Old component gone: `test ! -e tools/wal-observer/web/src/components/FilterBar.tsx`

#### Manual Verification:

- Events tab, first load: no filters at the top; a "Filters" handle near the top of the right edge;
  hovering or clicking it slides the panel in; leaving closes it unless an input has focus.
- The handle never overlaps the window scrollbar, and dragging the scrollbar does not open the panel.
- The arrow `«` in the panel pins it: the panel stays, the table narrows, the setting survives a reload;
  `»` unpins.
- Every filter works as before: search, category, agent tree, tool and MCP picker (expands inline,
  not clipped), event, date, time, duration, `nodur`, Reset (also clears a half-typed number).
- Active filters show as a count on the handle while the panel is hidden.
- Sessions tab: no handle, no panel, no right margin, even when `wal.fpin` is pinned.
- Live / View / Format still work from the top bar; the table header sticks under it.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Sticky Events head

### Overview

The sticky block becomes the Events head: usage tiles plus one merged line with the total, the
category counts, the active-filter summary and the view controls.

### Changes Required:

#### 1. Merged stats line

**File**: `tools/wal-observer/web/src/components/StatsHeader.tsx`

**Intent**: Replace the 52px hero, its separate label and the category tile row with one compact
inline run.

**Contract**:
- Props are unchanged.
- It renders the total as a medium-sized number, the existing label text (keep "matching" and
  "recorded" distinct, and keep the error text), then one compact count per category (dot, label,
  count).
- It renders inline content for a flex row owned by `EventsTab`.

#### 2. EventsTab composes the sticky head

**File**: `tools/wal-observer/web/src/components/EventsTab.tsx`

**Intent**: The sticky `.bar` becomes the head. The `--bar-h` observer stays on it, so `thead` and
the table pill sit under the whole block.

**Contract**:
- Row 1: `<UsageTiles>`.
- Row 2 (`.evline`, flex, wrapping):
  - `<StatsHeader>`;
  - when filters are active, `filterSummary(...).join(' · ')` with a Reset button calling `reset()`;
  - a spacer;
  - Live, View, `FormatSeg`, the events live dot/requery text.
- New props: `usage`, `usageLive`, `usageError`, `picked`, forwarded to `UsageTiles`.

#### 3. App: usage tiles per tab

**File**: `tools/wal-observer/web/src/App.tsx`

**Intent**: Render `UsageTiles` in `.main` only when the Events tab is not mounted (Sessions tab or
still loading). On Events, pass the usage data down to `EventsTab`.

**Contract**: One `UsageTiles` instance is visible at any time; `LegacyBanner` stays where it is.

#### 4. Head CSS

**File**: `tools/wal-observer/web/src/styles.css`

**Intent**: Style the compact head and drop rules that no longer have users.

**Contract**:
- Add `.evline` (flex, wrap, centred, gap) and a compact per-category count style.
- `.bar` keeps `position: sticky; top: 0; z-index: 2; background: var(--plane)`.
- Remove `.hero`, `.hero-label` and the `.tiles` margin if they are unused.
- `.usage` margins suit the sticky block.

#### 5. README

**File**: `tools/wal-observer/README.md`

**Intent**: Update "The page" to match the new layout.

**Contract**:
- Sidebar bullet: the arrow replaces Pin.
- Header usage tiles: sticky on Events, at the top on Sessions.
- Events bullet: the filters sit in the right panel. Cover the handle and count, pin via the arrow,
  default unpinned, and the merged line with the summary, Reset and view controls.

### Success Criteria:

#### Automated Verification:

- Type checks pass: `cd tools/wal-observer && npm run check`
- Build and tests pass: `cd tools/wal-observer && npm test`
- No dead hero styles: `grep -n "\.hero" tools/wal-observer/web/src/styles.css` returns nothing

#### Manual Verification:

- Events: scrolling the list (tail and table view) keeps the usage tiles and the merged line pinned
  at the top. The table header sits directly under them, and the "N new" pill in table view sits
  below the header.
- The merged line shows the total, the label, and the category counts on one line on a ~1440px
  window. On a narrow window it wraps without overlapping the table.
- With a filter active, the line shows the summary and Reset; Reset clears it and the handle badge.
- Live, View, Format and the live/requery text work from the head; follow-to-edge and loading older
  pages still behave in tail view.
- Sessions tab: usage tiles at the top, scroll away normally; its tables are unaffected.
- Light and dark themes both read correctly (head background covers rows scrolling beneath).
- README matches what the page does.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Testing Strategy

### Unit Tests:

- None new. The change is layout and component wiring. The only logic it reuses, `filterSummary`, is
  already covered by `web/src/lib/params.test.ts`. The repo has no DOM test harness, and adding one
  is out of scope.

### Integration Tests:

- `npm test` builds the page with vite (catches broken imports and JSX), then runs the existing
  suites unchanged.

### Manual Testing Steps:

1. Run `wal` (after `npm run build`, or `npm run dev` against a running server), pick 2+ sessions.
2. Walk through each phase's manual checklist in both panel states: left pinned plus right unpinned
   (the defaults), and both pinned.
3. With both panels pinned on a ~1280px window, check that the table stays usable. Its fixed column
   widths total 700px plus the session column.
4. Switch to Sessions and back; filters, follow and the panel pin state survive the switch.

## Performance Considerations

None material. The sticky head adds one `ResizeObserver` (moved, not new); the panel is fixed and
does not reflow `.main` except on pin toggle.

## Migration Notes

The `wal.filters` fold key becomes unused and is left in existing browsers' localStorage, where it
does nothing. The new `wal.fpin` defaults to `unpinned`.

## References

- Prior sidebar pin/hover design: `.ai/archive/2026-10-08-wal-observer-session-aware/plan.md:362-365`
- Filters not persisted: `.ai/archive/2026-09-29-wal-viewer-query/plan.md:65`
- Sidebar chrome today: `tools/wal-observer/web/src/components/Sidebar.tsx:148-160`, `styles.css:175-189`
- Sticky offset: `tools/wal-observer/web/src/components/FilterBar.tsx:55-60`, `styles.css:109,149`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Shared SidePanel with arrow toggle

#### Automated

- [x] 1.1 Type checks pass: `npm run check`
- [x] 1.2 Build and tests pass: `npm test`
- [x] 1.3 No leftover pin badge or `sb-edge`

#### Manual

- [ ] 1.4 Left sidebar arrow pins/unpins and persists
- [ ] 1.5 Unpinned edge strip reveal and close still work
- [ ] 1.6 Prompt tooltip still works and keeps the unpinned sidebar open
- [ ] 1.7 Slid-out sidebar controls are not tabbable

### Phase 2: Right filter panel

#### Automated

- [x] 2.1 Type checks pass: `npm run check`
- [x] 2.2 Build and tests pass: `npm test`
- [x] 2.3 `FilterBar.tsx` removed

#### Manual

- [ ] 2.4 Handle reveals the unpinned right panel; focus keeps it open
- [ ] 2.5 Handle clear of the window scrollbar
- [ ] 2.6 Arrow pins/unpins the right panel and persists
- [ ] 2.7 Every filter works from the panel, pickers expand inline
- [ ] 2.8 Handle shows the active-filter count
- [ ] 2.9 Sessions tab has no right panel or margin
- [ ] 2.10 View controls work from the top bar, table header sticks

### Phase 3: Sticky Events head

#### Automated

- [x] 3.1 Type checks pass: `npm run check`
- [x] 3.2 Build and tests pass: `npm test`
- [x] 3.3 No dead hero styles

#### Manual

- [ ] 3.4 Usage tiles and merged line stay sticky; header and pill sit below
- [ ] 3.5 Merged line fits one line on a wide window, wraps cleanly on narrow
- [ ] 3.6 Filter summary and Reset in the head
- [ ] 3.7 Live, View, Format and tail behaviour work from the head
- [ ] 3.8 Sessions tab usage tiles unchanged
- [ ] 3.9 Light and dark themes read correctly
- [ ] 3.10 README matches the page

### 3.2: Sticky page header (board item 3.2, added after review)

#### Automated

- [x] 3.2.1 Type checks pass: `npm run check`
- [x] 3.2.2 Build and tests pass: `npm test`

#### Manual

- [ ] 3.2.3 Header sticks on both tabs; on Events the head stacks under it, table header and pill below both
- [ ] 3.2.4 Filters handle sits below the header and never covers Toggle theme or the usage row
- [ ] 3.2.5 A long filter summary truncates with an ellipsis and shows in full on hover
