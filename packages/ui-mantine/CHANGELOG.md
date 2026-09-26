# @ranjeetk25/schema-grid-ui-mantine

## 0.3.1

### Patch Changes

- d2918f3: v0.3.1 — save feedback and integration fixes from the first consumer pages.

  **Save feedback**

  - The server's per-cell save errors (`ChangeResult.errors[].message`, e.g. "The student has not uploaded: X") are now shown: the failed cell carries the message as its tooltip (`title`), the live region announces the first message, and `<SchemaGridWorkbench>` (both kits) shows a dismissible "N changes failed" banner listing the distinct messages (max 5, then "and N more"), auto-dismissed after 8 s unless hovered. `onError` receives `{ kind: "save", op: "applyChanges", errors }`. Conflicts stay on the conflict prompt.

  **Rows after a save**

  - `ChangeResult.rows?: GridRow[]` (wire passthrough): the refreshed rows for every row in the batch, read after the write — formulas, `compute`, `mapRows` and projection applied. The in-memory source, `createDrizzleDataSource` and `createSqlViewDataSource` populate it (inside the write transaction).
  - New optional operation `getRows` (`DataSource.getRows?(ids)`, wire `{ ids }` → `GridRow[]`), implemented by all three sources and the remote client.
  - The grid upserts `result.rows` into the row store (computed columns update without polling). When a source omits them, `refetchAfterSave` (new `useSchemaGrid` / `<SchemaGrid>` / workbench prop; default true in server mode, false in client mode) fetches the affected ids through `getRows`. `handle.refreshRows(ids)` and the workbench slot context's `refreshRows(ids)` do the same on demand.

  **No repeat confirmation on conflict overwrite**

  - `ChangeBatch.resubmitOf?: string` (wire passthrough) marks a batch the edit controller re-submits after "Overwrite"; the original batch's `meta` is carried over. The workbench skips the host `beforeCellsChange` for such batches (the internal chain still runs) unless `confirmOnResubmit: true`.

  **Server**

  - `write.afterCommit(ctx, outcome)` on `createSqlViewDataSource` and `afterCommit` on `createDrizzleDataSource`: awaited after the transaction commits (never inside it); a throwing hook is reported through `onWarning` / `console.error` and never changes the result. Also fired for `createRows` (`{ created }`) and `deleteRows` (`{ deletedIds }`).
  - `columns[key].sortExpr` / `filterExpr` on the SQL view: alternative expressions used for `ORDER BY` + keyset paging and for `WHERE`, so hot sort/filter keys can hit an index (see "Performance on existing tables" in the server README).
  - Schema editability distinguishes "forbidden" from "unavailable": `SchemaStore.available?()` (the Drizzle store checks that its table exists, cached per instance), `defineGrid.schemaWritable?(ctx)`, `capabilities.schema.reason?: "forbidden" | "no-store" | "store-unavailable"`, and `updateSchema` answers `UNSUPPORTED_OPERATION` 501 (`details.reason: "schema-store-unavailable"`) instead of 403 when the store is missing or unavailable. The workbench shows why column changes are unavailable.

  **Options**

  - `Option.settableBy: { roles: [] }` reads "Option “X” can’t be set manually" (was "…by nobody"); `Option.settableMessage` overrides the message everywhere the rule fires (core, server, editors, paste).

  **io**

  - `@ranjeetk25/schema-grid-io` and its `./export` subpath gain a `browser` export condition whose build contains no `node:` specifier (Blob writers only; `buildExportStream` throws "not available in the browser"). Vite no longer warns about `node:stream`. The default / Node entry is unchanged.

  **Docs**

  - `docs/upgrading.md` (0.2 → 0.3 Express strict-JSON note, 0.3 → 0.3.1), wire contract (`getRows`, `rows`, `resubmitOf`).

- Updated dependencies [d2918f3]
  - @ranjeetk25/schema-grid-core@0.3.1
  - @ranjeetk25/schema-grid-io@0.3.1
  - @ranjeetk25/schema-grid-ag-grid@0.3.1

## 0.3.0

### Minor Changes

- 78a7209: v0.3 — integration findings from the first consumer pages.

  **Workbench**

  - `<SchemaGridWorkbench events={…}>` (and `gridProps.events`) merges host events with the built-in ones: `beforeCellsChange` chains host → internal (the host may veto with `false` or return a reduced / transformed batch), every other event fans out to both.
  - Schema editability is known up front: `DataSourceCapabilities.schema { read, write }` (default `read: true, write: false`). A grid registry answers it from `permission(ctx, "getSchema" | "updateSchema")` and its schema store; the workbench hides "+ Add column", the header "Edit column… / Insert…" entries and the column panel when `schema.write` is false (`features.addColumn` still only turns it off).
  - New toolbar **Columns** picker: search, show/hide per column, reorder, "Show all" / "Hide all", hidden-count badge. Changes live in the current view's `columnState` (saved with the view, undone by switching views). Permission-hidden columns are never listed.
  - Quick export names files `${gridId}-${view}-${YYYY-MM-DD}.csv` (slugified); `exportFileName` prop (string or function) overrides it. Export failures reach `onError` and an inline banner with Retry (quick export and the Export dialog).
  - The "saved" status counts applied cells only; quietly rejected changes show as "N changes not saved".
  - io (`@ranjeetk25/schema-grid-io/*`), the Import wizard and the Export dialog are loaded on first use, and exceljs is split into its own chunk (see docs/bundle.md).

  **Per-option write rules**

  - `Option.settableBy?: "all" | { roles: string[] }` on select / multiSelect / creatableSelect options. `resolveSettableOptions(column, user)`, `canSetOption`, `optionRuleViolation`. Core, the in-memory source and the server reject a change that introduces an option the user cannot set ("Option “Verified” can only be set by Admin"); existing values stay readable. Editors hide/disable such options; paste and fill count them as errors; the column panel's Options editor has a per-option "Who can set" control.

  **Silent rejection**

  - `ChangeResult.rejected?: CellChange[]`: not applied, not an error. The client reverts the optimistic value with no error state; `ClipboardReport.rejected` counts them; a `beforeCellsChange` that drops changes reports them as `rejected` in the submit outcome (never sent).

  **Change metadata**

  - `ChangeBatch.meta` / `CellChange.meta` (JSON) travel with a change untouched by validation and the client write check, reach data sources and `write.update`, and are echoed on `applied` / `rejected` / `conflicts`. The server's change log stores `meta` when present (existing installs: `ALTER TABLE <change_log> ADD COLUMN meta JSON NULL`).

  **Server**

  - `createSqlViewDataSource` `columns[key].compute?: (row) => unknown` — a column derived in JS after fetch (automatically unsortable, unfilterable, read-only).
  - Clear `MISSING_TABLE` errors naming the DDL helper to run when the schema store / extension / grid tables are missing.
  - `SchemaGridHandle.exportCsv()` now returns a `Promise<void>` that rejects on failure instead of swallowing errors.

  **Breaking (0.x)**

  - The `GET /:gridId/schema` route is gone from every adapter and the demo API; fetch the schema with the wire op `POST /:gridId/getSchema` (`createGridClient().getSchema()`). `GET /` (list grids) stays.

- 0b4f590: v0.3 — server hooks and time zones (integration findings).

  **SQL view: per-cell write outcomes**

  - `write.update` answers any subset of `{ applied, rejected, errors, conflict, version }` (`SqlViewUpdateOutcome`): `errors` → `ChangeResult.errors`, `rejected` → `ChangeResult.rejected`, cells the hook mentions nowhere count as `rejected`, applied cells bump the row version once (`version`, or a re-read when omitted), nothing applied → no `versions` entry. `write.create(ctx, partials, storage)` may answer `{ rows, errors: [{ index, columnId?, message }] }` → `RowValidationError` (`ROW_INVALID` 400), transaction rolled back.

  **Post-read hook, computed columns, default sort**

  - `RowSource.mapRows` (server): a batched hook after hydration and formula evaluation, before projection, on fetch (SQL and formula fallback), the change feed and `createRows`. `createSqlViewDataSource` / `createDrizzleDataSource` take `mapRows(rows, ctx)` / `mapRow(row, ctx)` (e.g. signing file URLs; hidden cells are visible to the hook, every mapped column is selected when a hook is configured).
  - `createSqlViewDataSource` `columns[key].compute?` runs after formulas and before `mapRows`; `computed: { key: { kind } }` declares mapRows-only columns. Both are unsortable, unfilterable, unsearchable and read-only (`isComputedColumn`).
  - `defaultSort: SortSpec[]` on both sources: applied when a query has `sort: []` (also the keyset tie-break), reported as `DataSourceCapabilities.defaultSort` (new optional core field, passed through `normalizeCapabilities` / `mergeCapabilities`). `createDrizzleDataSource` now implements `capabilities()`.

  **Bare JSON bodies vs `express.json()`**

  - ag-grid `createHttpDataSource` / `createGridClient` send `null` inputs (`capabilities`, `getSchema`) as a body-less POST without `content-type`; arrays and objects are unchanged.
  - server `toExpressRouter` / `toExpressHandler` read a missing / empty / `{}` / raw `"null"` body as `null` for the null-input ops (`normalizeRequestBody`, `isNullInputOperation` in `/http`). Docs: mount the grid router before the global `express.json()` or use `express.json({ strict: false })`.

  **Naive dates read as UTC**

  - SQL view: `date` columns are read as `DATE_FORMAT(col, '%Y-%m-%d')` (never a zone-shifted `Date`); `datetime` columns as naive wall times interpreted in **`naiveDatetimeZone`** (new option, default = `tz`) into UTC ISO, compared in UTC via `CONVERT_TZ` for filters / sorts / cursors, and written back as wall time: the write hooks receive storage-ready `values` (update) / `storage` (create). **Behaviour change:** DATETIME columns that store UTC must set `naiveDatetimeZone: "UTC"`.
  - `hydrateRow(dbRow, schema, registry, { naiveDatetimeZone })`, `dateOnlyFromDriver`, `naiveDatetimeToIso`, `isoToNaiveDatetime` exported from `/drizzle`; `createDrizzleDataSource({ naiveDatetimeZone })` for physical datetime columns (reads).
  - core: `date.parse(Date)` reads the calendar day in `DateConfig.timeZone` (default `Asia/Kolkata`) instead of `toISOString()`; `datetime.parse` accepts `YYYY-MM-DD HH:MM:SS[.fff]` as a wall time in `config.timeZone`.

### Patch Changes

- Updated dependencies [78a7209]
- Updated dependencies [0b4f590]
  - @ranjeetk25/schema-grid-core@0.3.0
  - @ranjeetk25/schema-grid-ag-grid@0.3.0
  - @ranjeetk25/schema-grid-io@0.3.0

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
  - @ranjeetk25/schema-grid-ag-grid@0.2.0
  - @ranjeetk25/schema-grid-core@0.2.0
  - @ranjeetk25/schema-grid-io@0.2.0

## 0.1.0

### Minor Changes

- f349d8f: First public release on npm under the MIT license. All `@ranjeetk25/schema-grid-*` packages are versioned in lockstep (Changesets `fixed` group), so every package shares one version number.
- 831a772: Initial release: Mantine v8 editors/renderers and `createMantineUiRegistry`, filter builder with chips and button, column builder modal (Zod auto-form, formula editor), view switcher, group-by bar, conflict popover, import wizard, export dialog, clipboard-report toast and grid theme bridge.

### Patch Changes

- Updated dependencies [f349d8f]
  - @ranjeetk25/schema-grid-core@0.1.0
  - @ranjeetk25/schema-grid-io@0.1.0
  - @ranjeetk25/schema-grid-ag-grid@0.1.0
