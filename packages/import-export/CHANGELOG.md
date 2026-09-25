# @ranjeetk25/schema-grid-io

## 0.2.0

### Minor Changes

- d62631e: Grids over existing tables (server):

  - `createSqlViewDataSource` (`/drizzle`) exposes any existing MySQL table or join as a grid: explicit column expressions over a base query, optimistic writes through `write.update/create/delete` hooks (read-only when absent), `capabilities()`, and an `updated_at` change feed (`changeFeed: "updates-only"`).
  - Extension columns beside an existing table: `createExtensionCellStore` + `createExtensionCellsTableDDL` (`/ddl`); schema columns without a mapping are stored per `(grid_id, row_id)`, LEFT JOINed for filter/sort/search/grouping and version-checked on write.
  - Schema store: `SchemaStore` (core), `createDrizzleSchemaStore` + `createGridSchemasTableDDL`.
  - The SQL translators now resolve columns through a public `ColumnExprResolver` seam (`createJsonCellsResolver`, `createMappedColumnResolver`, `SqlScope.columnExprs`) and select FROM a `RowSource` (`SqlScope.rowSource`); SQL for the JSON-cells grid is unchanged.
  - `drizzle-orm` peer range widened to `>=0.41.0 <1` (tested against 0.41 and 0.45).

- 6b1d8b4: Column options, data-source capabilities and client-side write enforcement.

  - core: `ColumnDef.sortable` / `filterable` / `settable` (default true). `resolveColumnAccess` caps `settable: false` columns at "read"; `validateFilter` rejects conditions on unfilterable columns (`unfilterableColumn`).
  - core: `DataSourceCapabilities` (`changeFeed: boolean | "updates-only"`), `DEFAULT_CAPABILITIES`, `normalizeCapabilities`, `inferCapabilities`, `getDataSourceCapabilities`, `mergeCapabilities` → `EffectiveCapabilities`, `applyEffectiveCapabilities`; optional `DataSource.capabilities()`. New wire op `capabilities` (input `null`); `createDataSourceHandler` answers a computed default for sources without it, `createRemoteDataSource` passes it through (`supports.capabilities: false` for older servers). New wire code `UNSORTABLE_COLUMN` (400). The in-memory source implements capabilities and clamps `page.limit` to `maxPageSize`.
  - server: sorting on a `sortable: false` column is rejected (`PermissionError`, usage `sort`, code `UNSORTABLE_COLUMN`); writes to `settable: false` columns are rejected as read-only.
  - ag-grid: `useSchemaGrid` fetches capabilities (and again after a schema change) and applies them: unsortable headers, hidden filter affordances, group/search/polling/write toggles, `maxPageSize` clamping for fetches and export; exposes `effectiveCapabilities`. Client loading and export never stop on a short page. The edit controller filters every change through `canEditCell` before the optimistic apply (rejections are "Read-only" errors and count as `skippedReadOnly` for paste/fill); undo/redo re-check at execution time. `HeaderMenuActions.canSort`.
  - ui-mantine / ui-shadcn: filter pickers hide `filterable: false` columns; header menus hide sort items for unsortable columns. ui-mantine imports `@tabler/icons-react` per icon.
  - `SCHEMA_GRID_*_VERSION` constants now come from package.json.

- db74b86: Many grids behind one endpoint (spec C5).

  - core `./wire`: grid-level operations `getSchema` / `updateSchema` (`GRID_SCHEMA_OPERATIONS`, `isGridSchemaOperation`,
    `gridSchemaSchema`) and the wire codes `UNKNOWN_GRID` (404), `METHOD_NOT_ALLOWED` (405) and `SCHEMA_CONFLICT` (409).
    `GRID_OPERATIONS` is now documented as a set that later versions extend.
  - server `./http`: `defineGrid`, `createGridRegistry` (`handle(gridId, op, input, ctx)`, `list(ctx)`),
    `createMemorySchemaStore`, `toFetchHandler` (Web `Request → Response`), `toExpressRouter`, a registry overload of
    `toLambdaHandler`, and `toWireFailure`.
  - ag-grid: `createGridClient({ baseUrl, gridId })` → `{ dataSource, getSchema, updateSchema, capabilities }`.

- ecd8310: `<SchemaGridWorkbench>` in ui-mantine and ui-shadcn: a whole admin grid page in one component (header, saved views with a pluggable `viewStore`, filter + chips, group, search, undo/redo, import, export, add/edit column panel with ghost preview, conflict prompt, polling, status bar). Features are derived from the grid's effective capabilities (the source's `capabilities()` as `useSchemaGrid` loads them, merged with core `mergeCapabilities`) and can only be switched off; `"updates-only"` change feeds poll without removing rows and `export.maxRows` caps the quick CSV export; built-in banners cover read-only sources, permission denied, network/offline (retry), unsupported operations and schema changes (reload). Accepts a grid client (`createGridClient`) or `dataSource` + `schema`.

### Patch Changes

- Updated dependencies [d62631e]
- Updated dependencies [6b1d8b4]
- Updated dependencies [db74b86]
- Updated dependencies [ecd8310]
  - @ranjeetk25/schema-grid-core@0.2.0

## 0.1.0

### Minor Changes

- f349d8f: First public release on npm under the MIT license. All `@ranjeetk25/schema-grid-*` packages are versioned in lockstep (Changesets `fixed` group), so every package shares one version number.

### Patch Changes

- Updated dependencies [f349d8f]
  - @ranjeetk25/schema-grid-core@0.1.0
