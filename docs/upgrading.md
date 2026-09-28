# Upgrading

All `@ranjeetk25/schema-grid-*` packages are released in lockstep: upgrade every
one of them (server, ag-grid, ui-*, io, core) to the same version in one change.
A mixed set is not supported; the wire contract lives in
[`wire-contract.md`](./wire-contract.md).

## 0.2 → 0.3

### Bare `null` bodies and `express.json()`

The op input is the JSON value itself, and it is `null` for `capabilities` and
`getSchema`. A **0.2 browser client** POSTs those two ops with the literal body
`null` and `content-type: application/json`. Express's `express.json()` is strict
by default: a body that does not start with `{` or `[` is answered with **400**
before the schema-grid wire layer ever runs, so the grid shows no schema and no
capabilities. Any one of these fixes it:

1. Turn strict mode off on the grid path, or mount the grid router before the
   app-wide parser (the "Server (Express)" wiring in
   [`consuming.md`](./consuming.md)):

   ```ts
   app.post("/api/grid/:op", express.json({ strict: false }), toExpressHandler(grid, { context }));
   // or, with several grids:
   app.use("/api/grid", express.json({ strict: false }), toExpressRouter(grids, { context })); // grid first
   app.use(express.json()); // everything else, strict as before
   ```

2. Upgrade the clients first. A **0.3 client** sends those ops as a body-less
   POST (no `content-type`), which any parser lets through.

3. Nothing else: v0.3 `toExpressRouter` / `toExpressHandler` already treat a
   missing, empty, `{}` or raw `"null"` body as `null` for exactly those ops.
   Only the strict parser's own 400 stands in the way.

### Removed: `GET /grid/:gridId/schema`

There is exactly one way to read a schema: `POST /grid/:gridId/getSchema`. The
`GET …/schema` alias is gone; anything that called it (curl scripts, health
checks, custom clients) must switch to the POST.

## 0.3 → 0.3.1

Additive; no wire or type breaks. In short:

- `ChangeResult.rows` / `getRows` — optional. A server may return the rows a
  batch produced; clients that ignore them are unaffected.
- `ChangeBatch.resubmitOf` — optional id of the batch this one replaces.
- `@ranjeetk25/schema-grid-io` ships a **browser build** under the `browser`
  export condition (`dist/index.browser.*`, `dist/export/index.browser.*`) that
  reaches no `node:` module. Same names as the Node entry; `buildExportStream`
  throws `"buildExportStream is not available in the browser; use
  buildExportBlob"` there and `buildExport` always returns a Blob. Bundlers
  that honour `browser` stop warning about `node:stream`. See
  [`bundle.md`](./bundle.md).
- Option copy: the read-only hint now reads "can't be set manually".
- `capabilities.schema.reason` — optional string explaining why the schema
  is not editable.

## 0.3.1 → 0.4

Additive: cell colors (conditional color rules per view, shared manual colors,
filter by color). Nothing changes until you opt in on the server; upgrade every
package together as usual.

- **New table (opt-in).** Manual colors need one table per database, shared by
  all grids. Run once (idempotent), then pass the store as `colors` to
  `createDrizzleDataSource` / `createSqlViewDataSource`:

  ```ts
  import { createCellColorsTableDDL } from "@ranjeetk25/schema-grid-server/ddl";
  import { createCellColorStore } from "@ranjeetk25/schema-grid-server/drizzle";

  await db.execute(sql.raw(createCellColorsTableDDL({ table: "grid_cell_colors" }).sql));
  const colors = createCellColorStore({ db, table: "grid_cell_colors" });
  ```

  ```sql
  CREATE TABLE IF NOT EXISTS `grid_cell_colors` (
    `grid_id` VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    `row_id` VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    `colors` JSON NOT NULL,
    `updated_at` DATETIME(3) NOT NULL,
    `updated_by` VARCHAR(64) NULL,
    PRIMARY KEY (`grid_id`, `row_id`),
    KEY `idx_grid_cell_colors_grid_updated` (`grid_id`, `updated_at`)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_ci
  ```

  Without a store, `capabilities.cellColors` is `{ read: false, write: false,
  filter: true }`: rule colors render and filter, painting is hidden.
- **Wire.** New optional op `setCellColors`; `GridQuery.colorRules`,
  `GridRow.colors` and `capabilities.cellColors` are optional fields. A 0.3.x
  server answers `setCellColors` with 501 and never reports `cellColors`, so a
  0.4 grid simply hides painting. See
  [`wire-contract.md`](./wire-contract.md#cell-colors-v04).
- **`change_log` kind `color`.** On the JSON-cells grid a paint writes one
  `change_log` row per cell with `kind = "color"` (next to `cell` / `create` /
  `delete`); code that reads `change_log` directly should expect it. No DDL
  change: `kind` is `VARCHAR(16)`.
- **`projectRow`** (root export) now also drops manual colors of unreadable
  columns; rows without colors carry no `colors` key.
- **Cursors** of queries with a `colorIs` / `colorIsNone` condition include the
  color rules in their fingerprint; other cursors are unchanged.
