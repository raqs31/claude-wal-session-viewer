---
change_id: wal-filter-panel
title: WAL viewer — filters in a right side panel, shared panel component, sticky Events head
status: archived
archived_at: 2026-10-09T12:47:47Z
created: 2026-10-09
updated: 2026-10-09
---

## Notes

- Requested as `change-wal-fitlers`; renamed to `wal-filter-panel` during planning.
- Move the Events filters from the top bar into a right side panel that behaves like the left Sidebar
  (pin or hover reveal). Extract a shared panel component and replace the Pin/Unpin badge with a small
  arrow. Make the Events head sticky with the input/output usage totals, and put the event total and
  the per-category counts on one line.
