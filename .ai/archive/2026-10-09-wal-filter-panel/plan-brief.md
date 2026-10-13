# WAL viewer — filter side panel and sticky Events head — Plan Brief

> Full plan: `.ai/changes/wal-filter-panel/plan.md`

## What & Why

On the Events tab, the filters take up a sticky bar at the top of the page, while the left session
Sidebar already slides away when not needed. This change moves the filters into a right side panel
that behaves like the left one, and both panels share one component with a small arrow toggle. That
frees the top for a compact sticky head with the input/output totals and the event counts on one line.

## Starting Point

- **Left Sidebar:** a fixed panel with a `Pin`/`Unpin` text badge (`wal.pin`). Unpinned, it is
  revealed by a full-height left-edge strip.
- **Filters:** `FilterBar` renders them horizontally in a sticky bar. The same bar also holds the
  Live / View / Format controls, and its height (`--bar-h`) offsets the sticky table header.
- **Events head:** a 52px event total, a label line and a row of category tiles.
- **Usage tiles:** global, above both tabs, not sticky.

## Desired End State

- **Both panels:** they use one `SidePanel` with a corner arrow (`«`/`»`) instead of the badge.
- **Right filter panel:** Events only, unpinned by default. A small "Filters · N" handle near the top
  right reveals it on hover or click. The filters are stacked vertically, with no fold.
- **Sticky Events head:** the usage tiles, then one line with the total, the label, the category
  counts, the active-filter summary with Reset, and the view controls.
- **Sessions tab:** unchanged, apart from the arrow on the left panel.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
| --- | --- | --- |
| Merged line | Event total + category counts on one row | The user's "per call" line is the category tiles. Merging them removes the 52px hero. |
| Sticky block | Usage tiles + merged line, Events tab only | Matches "sticky with input/output total". |
| Usage tiles on Sessions | Kept at the top, not sticky | No pick-wide totals lost on Sessions. |
| View controls (Live/View/Format) | In the sticky merged line | They act on the list you're looking at, and you shouldn't need to open a panel for them. |
| Right panel default | Mirrors the left, unpinned by default, own key `wal.fpin` | The table keeps its full width by default. |
| Toggle | Small arrow in the panel's inner top corner | User's choice; it replaces the text badge on both panels. |
| Right reveal | Small handle near the top right, with a count badge, not a full-height strip | A right-edge strip would fight the window scrollbar. |
| Left reveal | Keeps its full-height edge strip | No scrollbar conflict there, so its behaviour stays the same. |
| Filter layout | Stacked, no fold. Summary and Reset in the head; count on the handle | Hidden filters can't silently empty the list. |
| Pickers in the panel | Expand inline, not as popovers | Absolute popovers would be clipped by the scrolling panel. |
| Change id | `wal-filter-panel` | Fixes the `change-wal-fitlers` typo and matches the other `wal-*` names. |

## Scope

**In scope:**
- `SidePanel` component
- Sidebar adoption of it
- `FilterBar` → `FilterPanel`
- right pin state
- sticky head, merged line, usage tiles per tab
- CSS
- README

**Out of scope:**
- filter semantics, params or API
- persisting filter values
- an inner scroll container
- Escape-to-close
- responsive auto-pin
- DOM tests
- clearing the stale `wal.filters` key

## Architecture / Approach

- **`SidePanel`:** owns the fixed `<aside>`, the reveal trigger (edge strip or handle), the slide CSS
  state and the arrow. The caller holds `open`, so the Sidebar's portaled tooltip can still keep it
  open.
- **App:** holds both pin states. `data-pin` and `data-fpin` reserve the margins, `data-fpin` only on
  Events.
- **`EventsTab`:** owns the sticky head, the `--bar-h` observer and the Reset counter that both Reset
  buttons share.
- **Data flow:** unchanged.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Shared SidePanel with arrow toggle | Left Sidebar on `SidePanel`, arrow instead of the Pin badge | Breaking the tooltip or focus-within behaviour of the unpinned sidebar |
| 2. Right filter panel | Filters in a right panel with handle and count, `wal.fpin` | Pickers clipped or mispositioned in a narrow panel; handle near the scrollbar |
| 3. Sticky Events head | Usage tiles plus merged line sticky, view controls and summary in the head, README | The sticky offset (`--bar-h`) for the table header and pill; head too tall on narrow windows |

**Prerequisites:** none. `.ai/changes/wal-sessions-tab/` is implemented but not archived. It touches
`App.tsx` and `styles.css` only in history, so there is no live conflict.

**Estimated effort:** about 1–2 sessions, 3 commits.

## Open Risks & Assumptions

- **Linux overlay scrollbars:** these can overlap even a short handle at the right edge. Phase 2's
  manual check covers it, and the handle's vertical position may need tuning.
- **Two pinned panels:** with both pinned, the table loses about 620px. That is acceptable, since the
  right panel defaults to unpinned.
- **No automated UI coverage:** behaviour is verified manually, per phase.

## Success Criteria (Summary)

- Filters are one hover away on the right and never push the event list down. The left and right
  panels look and toggle the same way.
- While scrolling events, the input/output totals and the event counts stay visible in one compact
  sticky head.
- `npm run check` and `npm test` pass after each phase.
