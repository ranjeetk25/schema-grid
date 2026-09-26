---
"@ranjeetk25/schema-grid-core": minor
"@ranjeetk25/schema-grid-ag-grid": minor
"@ranjeetk25/schema-grid-server": minor
"@ranjeetk25/schema-grid-io": minor
"@ranjeetk25/schema-grid-ui-mantine": minor
"@ranjeetk25/schema-grid-ui-shadcn": minor
---

v0.3 — integration findings from the first consumer pages.

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
