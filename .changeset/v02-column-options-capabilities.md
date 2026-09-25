---
"@ranjeetk25/schema-grid-core": minor
"@ranjeetk25/schema-grid-ag-grid": minor
"@ranjeetk25/schema-grid-io": minor
"@ranjeetk25/schema-grid-server": minor
"@ranjeetk25/schema-grid-ui-mantine": minor
"@ranjeetk25/schema-grid-ui-shadcn": minor
---

Column options, data-source capabilities and client-side write enforcement.

- core: `ColumnDef.sortable` / `filterable` / `settable` (default true). `resolveColumnAccess` caps `settable: false` columns at "read"; `validateFilter` rejects conditions on unfilterable columns (`unfilterableColumn`).
- core: `DataSourceCapabilities` (`changeFeed: boolean | "updates-only"`), `DEFAULT_CAPABILITIES`, `normalizeCapabilities`, `inferCapabilities`, `getDataSourceCapabilities`, `mergeCapabilities` → `EffectiveCapabilities`, `applyEffectiveCapabilities`; optional `DataSource.capabilities()`. New wire op `capabilities` (input `null`); `createDataSourceHandler` answers a computed default for sources without it, `createRemoteDataSource` passes it through (`supports.capabilities: false` for older servers). New wire code `UNSORTABLE_COLUMN` (400). The in-memory source implements capabilities and clamps `page.limit` to `maxPageSize`.
- server: sorting on a `sortable: false` column is rejected (`PermissionError`, usage `sort`, code `UNSORTABLE_COLUMN`); writes to `settable: false` columns are rejected as read-only.
- ag-grid: `useSchemaGrid` fetches capabilities (and again after a schema change) and applies them: unsortable headers, hidden filter affordances, group/search/polling/write toggles, `maxPageSize` clamping for fetches and export; exposes `effectiveCapabilities`. Client loading and export never stop on a short page. The edit controller filters every change through `canEditCell` before the optimistic apply (rejections are "Read-only" errors and count as `skippedReadOnly` for paste/fill); undo/redo re-check at execution time. `HeaderMenuActions.canSort`.
- ui-mantine / ui-shadcn: filter pickers hide `filterable: false` columns; header menus hide sort items for unsortable columns. ui-mantine imports `@tabler/icons-react` per icon.
- `SCHEMA_GRID_*_VERSION` constants now come from package.json.
