# @ranjeetk25/schema-grid-server

Node-side Schema Grid: schema validation, permission-checked MySQL queries via
Drizzle (`createDrizzleDataSource`), change feed, import/export jobs, DDL helpers
and transport-neutral HTTP adapters.

## Subpath exports

```
@ranjeetk25/schema-grid-server         – errors, schema validation, access, cursors, import/export jobs (no drizzle at runtime)
@ranjeetk25/schema-grid-server/drizzle – createDrizzleDataSource and the SQL translators
@ranjeetk25/schema-grid-server/ddl     – table / generated-column DDL
@ranjeetk25/schema-grid-server/http    – defineGrid / createGridRegistry and transport adapters (below)
```

## Serving a grid (`./http`)

`createGridRouterAdapter` turns a `DataSource` — or a per-request factory that binds
the user — into one `handle(op, input, ctx)` function. Every transport is a few
lines around it; none is a dependency of this package.

```ts
import { createDrizzleDataSource } from "@ranjeetk25/schema-grid-server/drizzle";
import { createGridRouterAdapter, toExpressHandler, toLambdaHandler } from "@ranjeetk25/schema-grid-server/http";

const grid = createGridRouterAdapter((ctx: { user: PermissionUser }) =>
  createDrizzleDataSource({ db, gridId: "admissions", schema, registry, resolver, user: ctx.user }),
);
```

`handle` never throws: it answers `{ ok: true, data }` or `{ ok: false, error: WireError, status }`. Throw
`Object.assign(new Error("Sign in"), { code: "UNAUTHENTICATED" })` from the factory for a 401. Server errors
map to wire codes (`PermissionError` → `PERMISSION_DENIED` 403, `FilterValidationError` → `FILTER_INVALID` 400,
`CursorError` → `INVALID_CURSOR` 400, `SchemaValidationError` → `SCHEMA_INVALID` 400,
`FormulaQueryLimitError` → `FORMULA_ROW_CAP` 413, unknown → `INTERNAL` 500). See
[`docs/wire-contract.md`](../../docs/wire-contract.md).

### Express (or anything with `req.params` / `req.body` / `res.status().json()`)

```ts
app.post("/api/grid/:op", express.json({ strict: false }), toExpressHandler(grid, { context: (req) => ({ user: req.user }) }));
```

**Why `strict: false` (or mount before the global `express.json()`)?** The wire input of an op is the JSON
value itself: an object for most ops, an array for none today, and `null` for `capabilities` / `getSchema`.
`express.json()` defaults to `strict: true`, which answers **400** to any body whose first character is not
`{` or `[` — so a bare `null` never reaches the handler. Since v0.3 the browser client
(`createHttpDataSource` / `createGridClient`) sends null inputs as a **body-less POST** (no `content-type`),
which every parser lets through, and the Express adapters read a missing / empty / `{}` (Express 4's
`express.json()` leaves `{}` when there is no body) / raw `"null"` body as `null` for exactly those ops
(`normalizeRequestBody`). Keep `strict: false` anyway for clients that still post `null`, or mount the grid
router **before** the app-wide `express.json()` so the grid path gets its own parser:

```ts
// either: its own, lenient parser on the grid path only
app.use("/api/grid", express.json({ strict: false }), toExpressRouter(grids, { context }));
app.use(express.json()); // the rest of the app, unchanged
// or: no parser at all — the adapters parse a raw string body themselves
app.use("/api/grid", express.text({ type: "application/json" }), toExpressRouter(grids, { context }));
```

### AWS API Gateway + Lambda (route `POST /grid/{op}`)

```ts
export const handler = toLambdaHandler(grid, {
  context: (event) => ({ user: userFromClaims(event.requestContext.authorizer) }),
  headers: { "access-control-allow-origin": "https://app.example.com" },
});
```

### Hono

```ts
app.post("/grid/:op", async (c) => {
  const input = await c.req.json().catch(() => undefined);
  const { status, body } = toHttpResponse(await grid.handle(c.req.param("op"), input, { user: c.get("user") }));
  return c.json(body, status as 200);
});
```

All three answer `200 { data }` or `<status> { error }`; the browser side is `createHttpDataSource({ baseUrl })`
from `@ranjeetk25/schema-grid-ag-grid`.

### tRPC (a mapping, not a dependency)

One procedure carries the op and returns the `WireResult` envelope, so error codes survive without
`TRPCError` mapping:

```ts
// server
export const gridRouter = router({
  call: protectedProcedure
    .input(z.object({ op: z.string(), input: z.unknown() }))
    .mutation(({ input, ctx }) => grid.handle(input.op, input.input, { user: ctx.user })),
});
// client
const dataSource = createRemoteDataSource(async (op, input) => unwrapWireResult(await trpc.grid.call.mutate({ op, input })));
```

`createDataSourceHandler` (from `@ranjeetk25/schema-grid-core/wire`) is the same thing without the per-request
factory, if you already have a `DataSource` in hand.

## Multi-grid endpoint (`defineGrid` + `createGridRegistry`)

Declare each grid once and serve all of them from one endpoint. `defineGrid` takes the grid's `id`
(URL-safe: `[A-Za-z0-9_-]+`), its `schema` (a `GridSchema`, or `(ctx) => Promise<GridSchema>`), a
`source(ctx, { gridId, schema })` that builds the per-request `DataSource`, and optionally:

| option | meaning |
|---|---|
| `permission(ctx, op)` | **the per-grid permission gate**: called for every op on this grid incl. `getSchema` / `updateSchema` / `capabilities`; false → `PERMISSION_DENIED` 403. Default: allow all. One-liner: `permission: (ctx, op) => op === "fetch" \|\| ctx.user.roles.includes("admin")` (read-only for everyone but admins). The `capabilities` answer reports `schema: { read: permission("getSchema"), write: schemaStore && permission("updateSchema") }` so the workbench can hide column editing up front (v0.3). |
| `schemaStore` | `{ get(gridId), put(gridId, schema) }`. A stored schema wins over `schema`. Without one, `updateSchema` → `UNSUPPORTED_OPERATION` 501. `createMemorySchemaStore()` is the in-process default. |
| `onSchemaChange(ctx, prev, next)` | runs after validation and **before** the new schema is persisted (DDL diff for generated / extension columns); throwing aborts the update. |
| `registry`, `validation` | field types and `assertValidSchema` options (e.g. `isFormulaTranslatable: formulaTranslatability()` from `./drizzle`). |

```ts
import {
  createGridRegistry,
  createMemorySchemaStore,
  defineGrid,
  toExpressRouter,
  toFetchHandler,
  toLambdaHandler,
} from "@ranjeetk25/schema-grid-server/http";

const admissions = defineGrid<Ctx>({
  id: "admissions",
  schema,
  schemaStore: createMemorySchemaStore(),
  permission: (ctx, op) => op !== "updateSchema" || ctx.user.roles.includes("admin"),
  source: (ctx, { schema }) => createDrizzleDataSource({ db, gridId: "admissions", schema, registry, resolver, user: ctx.user }),
});
const grids = createGridRegistry([admissions, leads], { onError: (err, info) => info.status >= 500 && log(err) });
```

`grids.handle(gridId, op, input, ctx)` never throws and answers the `WireResult` envelope; `grids.list(ctx)` lists
the grids whose `getSchema` the context may run. Unknown grid → `UNKNOWN_GRID` 404, unknown op →
`UNKNOWN_OPERATION` 404. `updateSchema` validates with `assertValidSchema`, requires the current `schemaVersion`
(else `SCHEMA_CONFLICT` 409 with `details.currentVersion`), bumps it, runs `onSchemaChange`, persists — serialised
per grid within the process.

Adapters (structural types, no framework dependency), all with the routes `POST /:gridId/:op`
(incl. `getSchema` / `updateSchema` — the schema has exactly one route since v0.3; the old
`GET /:gridId/schema` alias answers 405) and `GET /` (list):

```ts
// Web Request → Response: Hono, Bun.serve, Next.js route handlers, Workers
const endpoint = toFetchHandler(grids, { basePath: "/api/grid", context: (request) => ctxFrom(request) });
app.all("/api/grid/*", (c) => endpoint(c.req.raw));

// Express middleware (unmatched paths go to next()) — mount BEFORE the global express.json(), or use strict: false (see "Express" above)
app.use("/api/grid", express.json({ strict: false }), toExpressRouter(grids, { context: (req) => ({ user: req.user }) }));

// API Gateway: POST /grid/{gridId}/{op} (incl. getSchema), GET /grid
export const handler = toLambdaHandler(grids, { context: (event) => ctxFromClaims(event) });
```

The browser side is `createGridClient({ baseUrl: "/api/grid", gridId })` from `@ranjeetk25/schema-grid-ag-grid`
(`{ dataSource, getSchema, updateSchema, capabilities }`).

## Grids over existing tables (`createSqlViewDataSource`)

Expose any existing MySQL table (or join) as a grid — the same permission-checked
filter / search / sort / keyset paging / grouping SQL as the JSON-cells grid, with no
`cells` column on your table:

```ts
import { createExtensionCellStore, createSqlViewDataSource } from "@ranjeetk25/schema-grid-server/drizzle";

const source = createSqlViewDataSource({
  db, schema, resolver, user, tz: "Asia/Kolkata",
  baseQuery: (ctx) => ctx.db.select().from(leads).where(isNull(leads.deletedAt)), // no ORDER BY / LIMIT
  columns: {                                   // schema column KEY → expression
    name: { expr: leads.name },
    paymentStatus: { expr: leads.paymentStatus },
    callDate: { expr: leads.callDate },
    aiVerified: { expr: leads.aiVerified },    // mark the ColumnDef `settable: false`
  },
  rowId: leads.id,
  version: leads.version,                      // monotonic; omitted → CRC32 of the settable cells
  updatedAt: leads.updatedAt,                  // enables the updated_at change feed
  write: {                                     // absent → read-only (capabilities.write all false)
    update: async (ctx, { rowId, changes, baseVersion, values }) => { /* UPDATE … SET <values> WHERE id = ? AND version = ? */ },
    create: async (ctx, partials, storage) => { /* INSERT storage[i], return [{ id }] */ },
    delete: async (ctx, ids) => { /* DELETE / soft delete */ },
  },
  extension: createExtensionCellStore({ db, table: "grid_extension_cells" }), // optional
  mapRows: async (rows) => sign(rows),         // post-read hook (v0.3), e.g. signed file URLs
  defaultSort: [{ columnId: "callDate", dir: "desc" }], // when the query has no sort (v0.3)
  naiveDatetimeZone: "Asia/Kolkata",           // zone of DATETIME wall times; default: tz (v0.3)
});
```

- **Base query.** Wrapped as the derived table `(<base>) AS sg_base` (MySQL merges it, so
  your indexes apply). Drizzle columns in `columns` / `rowId` / `version` / `updatedAt` are
  re-pointed at `sg_base` by column name, so the base must select them under their own
  names (no duplicate output names across joins — select explicit fields). `baseQuery`
  receives the request context (`ctx.user`, …), e.g. to scope rows per counsellor.
- **Semantics.** A mapped expression is compared as-is (like a physical column): text
  matching follows its collation — use `utf8mb4_0900_as_ci` for exact parity with core
  (case-insensitive, accent-sensitive). `kind` overrides the storage kind, `searchable`
  the search participation. DATE / DATETIME handling is described under "Dates and time
  zones" below.
- **Writes.** `applyChanges` validates, permission-checks (row-aware) and rejects
  `settable: false` columns ("Read-only"), compares the client's base version with the
  current row version, then calls `write.update` inside a transaction (`ctx.db` is the
  transaction). Return `{ conflict }` when your guarded UPDATE matched no row; per-cell
  outcomes are described under "Per-cell write outcomes" below.
- **Extension columns.** Schema columns without a mapping live in the extension table
  (`createExtensionCellsTableDDL`, keyed by `(grid_id, row_id)`), LEFT JOINed on the row id
  and resolved by the JSON-cells resolver, so filter / sort / group / search work on them.
  Their writes are version-checked on the extension row. The row version is
  `version + extension version`, so a change on either side conflicts.
- **Change feed.** With `updatedAt`, `getChanges(since)` returns rows whose (effective)
  updated_at is after the cursor (`(updated_at, rowId)` keyset). Deletes are not
  detectable (`capabilities.changeFeed = "updates-only"`), and a write stamped with an
  updated_at *earlier* than one already delivered (clock skew, second-precision columns
  with a smaller row id in the same second) can be missed — prefer `DATETIME(3)`.
- **Capabilities.** `capabilities()` reports what the source supports (feed, writes,
  `maxPageSize` 500 — fetches are clamped to it); `defaultCapabilities` overrides it.

The seam behind it is public too: `createMappedColumnResolver` / `createJsonCellsResolver`
(`ColumnExprResolver`) and `RowSource` plug into `SqlScope.columnExprs` / `SqlScope.rowSource`
for `buildQuery`, `buildGroupQuery` and the translators.

### Schema store

`createDrizzleSchemaStore({ db, table })` persists a grid's schema (`SchemaStore` from core)
in the table from `createGridSchemasTableDDL({ table })` (`/ddl`) — used by `defineGrid`
for `getSchema` / `updateSchema` (e.g. the Workbench add-column flow).

### drizzle-orm versions

The peer range is `>=0.41.0 <1`; `bun run test:drizzle-matrix` runs the server typecheck
and unit suite against drizzle-orm 0.41.0 and 0.45 in scratch copies (CI does the same).

## Upgrading

### Binary collation for row ids

Rows tables now declare `id` as
`VARCHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin`, so the final `id`
sort tie-break and keyset cursors (`id > ?`) follow code-point order, exactly
like core's in-memory sort. Tables created by an older `createRowsTableDDL`
inherited the table's case/accent-insensitive default (`utf8mb4_0900_ai_ci`);
on those, paging can skip or repeat rows whose ids differ only by case or
accents, and the order can disagree with client-side sorting.

`createRowsTableDDL` uses `CREATE TABLE IF NOT EXISTS`, so it does **not**
change an existing table. Run the migration once per rows table:

```ts
import { alterRowsTableIdCollationDDL } from "@ranjeetk25/schema-grid-server/ddl";

const stmt = alterRowsTableIdCollationDDL({ table: "grid_rows" });
await connection.query(stmt.sql); // e.g. a mysql2 connection
// ALTER TABLE `grid_rows` MODIFY `id` VARCHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL
```

Notes:

- It is safe on existing data: ids that were unique under the old
  case-insensitive collation are still unique under `utf8mb4_bin`.
- Changing a primary key's collation makes MySQL rebuild the table
  (`ALGORITHM=COPY`, writes blocked while it runs). On large tables run it in a
  maintenance window or through an online schema-change tool (gh-ost,
  pt-online-schema-change) using the same column definition.
- Re-running it is harmless.
- To check whether a table needs it:
  `SELECT COLLATION_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'grid_rows' AND COLUMN_NAME = 'id';`
  — anything other than `utf8mb4_bin` needs the migration.
- The change-log table's `row_id` got the same definition for new installs. The
  server only stores and returns it (never sorts or compares it in SQL), so
  migrating it is optional; if you want identical schemas, run
  ``ALTER TABLE `grid_change_log` MODIFY `row_id` VARCHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL``.

## v0.3 additions

### Computed columns (`createSqlViewDataSource`)

A column derived in JavaScript from the fetched row — no SQL expression:

```ts
columns: {
  name: { expr: t.name },
  email: { expr: t.email },
  contact: { compute: (row) => `${row.cells.name} <${row.cells.email}>` },
}
```

`compute(row)` runs after hydration and formula evaluation on every read (`fetch`, `getChanges`, `createRows`),
before `mapRows`. The column needs no extension store, is read-only (writes answer "Column is read-only"), is
excluded from free-text search and is reported as neither sortable nor filterable in `capabilities` (`sort` /
`filter` become explicit column-id lists without it), so the grid turns those affordances off; the server
rejects them anyway (`UNSORTABLE_COLUMN` / `FILTER_INVALID`). Grouping by a computed column is a
`FILTER_INVALID` 400. A column whose value comes ONLY from `mapRows` (no `compute`) is declared with
`computed: { url: { kind: "text" } }` instead, with the same restrictions.

### Post-read hook: `mapRows` / `mapRow`

```ts
createSqlViewDataSource({
  …,
  mapRows: async (rows, ctx) => {              // batched; ctx = request context + db + gridId
    const urls = await signAll(rows.map((r) => r.cells.fileKey as string), ctx.user);
    return rows.map((r, i) => ({ ...r, cells: { ...r.cells, url: urls[i] } }));
  },
  mapRow: (row) => ({ ...row, cells: { ...row.cells, name: row.cells.name?.trim() } }), // per-row sugar, runs after mapRows
});
```

Runs after hydration, `compute` and formula evaluation and **before** projection, on every row-returning path
(`fetch` — SQL and formula-fallback —, `getChanges`, `createRows`). Because it runs before projection the hook
sees the WHOLE row: with `compute` / `mapRows` configured, every mapped and extension column is selected
regardless of the user's permissions (a hidden `fileKey` can feed a visible `url`); `projectRow` still strips
hidden cells from the answer. The hook must return one row per input row, in order (otherwise
`INTERNAL`). `createDrizzleDataSource` takes the same `mapRows` / `mapRow` (with the `ServerContext`) and
exposes them through `RowSource.mapRows` for custom row sources.

### Default sort

`defaultSort: SortSpec[]` is applied when a query has `sort: []` — to the SQL `ORDER BY` and therefore to the
keyset paging tie-break — and reported as `capabilities.defaultSort` (normalised through
`normalizeCapabilities` / `mergeCapabilities`). Columns the user cannot read are dropped per request;
an unknown or `sortable: false` column throws `INVALID_DEFAULT_SORT` at construction. `createDrizzleDataSource`
accepts it too (and now implements `capabilities()`).

### Per-cell write outcomes

`write.update` answers any subset of `{ applied, rejected, errors, conflict, version }`:

```ts
update: async (ctx, { rowId, changes, baseVersion, values, meta }) => {
  const [ok, locked] = partition(changes, (c) => c.columnId !== "fee");
  if (ok.length === 0) return { errors: locked.map((c) => ({ rowId, columnId: c.columnId, message: "Fee is locked" })) };
  const res = await ctx.db.update(t).set(pick(values, ok)).where(and(eq(t.id, +rowId), eq(t.version, baseVersion)));
  if (affectedRowsOf(res) === 0) return { conflict: { rowId, columnId: ok[0].columnId, serverValue: null, serverVersion: baseVersion, updatedAt } };
  return { applied: ok, errors: locked.map(…), version: baseVersion + 1 }; // omit `version` → the row is re-read
},
```

- `applied` cells reach `ChangeResult.applied`; the row version bumps **once** per row (`version`, or a
  re-read when omitted). `errors` (`{ rowId, columnId, message }`) reach `ChangeResult.errors`; `rejected` cells
  reach `ChangeResult.rejected` (declined quietly, the grid reverts them without an error state). Cells the hook
  mentions nowhere count as `rejected`. `conflict` short-circuits the row as before. The v0.2 shapes
  `{ applied, version }` / `{ conflict }` still fit. When nothing was applied the row has no `versions` entry.
- `write.create(ctx, partials, storage)` may answer `{ rows, errors: [{ index, columnId?, message }] }`: the
  first error becomes a `RowValidationError` (wire `ROW_INVALID` 400 with the row index) and the transaction
  rolls back. `storage[i]` are the storage-ready values of `partials[i]`.

### Dates and time zones

MySQL `DATE` / `DATETIME` carry no zone; mysql2 turns them into JS `Date`s in the pool's `timezone`
(default: the process's local zone), which shifts a `DATE` to the previous day east of UTC and reads a
`DATETIME` wall time as if it were local. The SQL view never lets the driver convert:

- `date` columns are selected as `DATE_FORMAT(col, '%Y-%m-%d')` and served as that day; writes hand the hook
  `YYYY-MM-DD` (`values` / `storage`).
- `datetime` columns are selected as `DATE_FORMAT(col, '%Y-%m-%d %H:%i:%s.%f')` — a naive wall time — and
  interpreted in **`naiveDatetimeZone`** (default: the source's `tz`, i.e. `Asia/Kolkata`) into UTC ISO. Writes
  go the other way: `values.calledAt` is the wall time in that zone (`YYYY-MM-DD HH:MM:SS.fff`), so bind
  `values`, not `changes[i].next`, in your UPDATE / INSERT. Filters, sorts and keyset cursors compare the column
  in UTC through `CONVERT_TZ(col, '+05:30', '+00:00')` (a numeric offset for zones without DST; zones with DST
  use `CONVERT_TZ(col, 'Zone/Name', 'UTC')` and need MySQL's time zone tables — `mysql_tzinfo_to_sql`).
  Columns that store UTC: `naiveDatetimeZone: "UTC"` (no conversion at all).
- `updatedAt` (the change feed) stays UTC as documented. `TIMESTAMP` columns are converted by MySQL to the
  **session** `time_zone` before any of this; keep it at `+00:00`.

mysql2 recommendation: `timezone: "Z"` (so the `Date`s other code paths receive carry the wall time in
their UTC fields) or `dateStrings: true`. Both are optional for the SQL view since v0.3. The JSON-cells
source (`createDrizzleDataSource`) keeps writing physical `datetime` columns in UTC; its reads take
`naiveDatetimeZone` for tables that hold local wall times, and `DATE` `Date`s are read from whichever
midnight the driver used (`dateOnlyFromDriver`). Core: `date.parse(Date)` reads the calendar day in
`DateConfig.timeZone` (default `Asia/Kolkata`) instead of `toISOString()`, and `datetime.parse` takes
`YYYY-MM-DD HH:MM:SS[.fff]` as a wall time in `config.timeZone`.

### Per-option write rules

`Option.settableBy` (`"all"` | `{ roles }`) on select / multiSelect / creatableSelect options is enforced in
`applyChanges` and `createRows`: a change that INTRODUCES an option the user may not set fails with
`Option “Verified” can only be set by Admin`; option ids the row already holds are never re-checked.

### Change meta and `rejected`

`ChangeBatch.meta` / `CellChange.meta` travel through `planChanges` unvalidated. The JSON-cells source echoes
the change's meta on its `applied` / `conflicts` entry and stores it in `change_log.meta`; the SQL view hands
it to `write.update` (`input.changes[i].meta`, `input.meta` = the batch's) and passes a hook's `rejected`
changes through to `ChangeResult.rejected`.

`change_log` tables created before v0.3 lack the `meta` column. Writes still succeed (the first
`ER_BAD_FIELD_ERROR` makes the process fall back to the legacy column list — `meta` is then simply not
logged); add the column once with

```ts
import { alterChangeLogTableMetaDDL } from "@ranjeetk25/schema-grid-server/ddl";
alterChangeLogTableMetaDDL({ table: "grid_change_log" }).sql; // ALTER TABLE `grid_change_log` ADD COLUMN `meta` JSON NULL
```

### Missing tables

When a table this package reads was never created — the grid rows / change log tables
(`createDrizzleDataSource`), the schema store table (`createDrizzleSchemaStore`) or the extension cells
table (`createSqlViewDataSource({ extension })`) — the MySQL `ER_NO_SUCH_TABLE` becomes a
`MissingTableError` (wire code `MISSING_TABLE`, HTTP 500) whose message names the table and the DDL helper
to run, e.g. ``Table `grid_schemas` does not exist. Create it with createGridSchemasTableDDL({ table: "grid_schemas" }) …``
(`details: { table, ddl }`). Run the DDL once at deploy / boot (the demo-api does this in `ensureLeadsStorage`).
## v0.3.1 additions

### Rows after a save (`ChangeResult.rows`, `getRows`)

Both sources answer `applyChanges` with `rows`: the current state of every distinct row id in the batch that
still exists, read **after** the writes and **inside the same transaction** (after the `change_log` insert in
`createDrizzleDataSource`; after the hooks' UPDATEs and the extension-store write in `createSqlViewDataSource`,
where this single re-read also settles the versions of rows whose `write.update` omitted `version`). Rows that
only had conflicts or errors are still returned, in their server state; unknown and soft-deleted ids are
skipped; order follows the batch (first appearance of each row id).

Every row is served exactly as `fetch` would serve it — formulas evaluated, `compute` columns derived from the
just-written cells, `mapRows` / `mapRow` applied, `naiveDatetimeZone` honoured, and `projectRow` stripping the
cells the user cannot read. Hidden cells still feed `compute` / `mapRows` (a hidden `fileKey` can refresh a
visible `url`), as on every other read path.

```ts
const res = await ds.applyChanges(batch);
res.rows; // [{ id, version, updatedAt, cells: { fee: 500, balance: 460, url: "https://signed/…" } }]
```

`ds.getRows(ids)` (wire op `getRows`, `{ ids }` → `GridRow[]`) reads the same shape on demand: order of `ids`,
unknown / deleted ids skipped, one `SELECT … WHERE id IN (…)` (none for `[]`). It is implemented by both
sources — `createSqlViewDataSource` declares it on `SqlViewDataSource` — and served automatically by
`createGridRegistry` and every HTTP adapter through `createDataSourceHandler`. There is no capability flag for
it; a custom source that lacks it gets a 501 from the handler.

The client upserts `ChangeResult.rows` into the grid after a save, so derived values (formulas, computed
columns, signed URLs) update without a refetch; `refetchAfterSave` falls back to `getRows` for the batch's
row ids when a source omits `rows`. `createDrizzleDataSource` exposes the shared read as
`readRowsById(db, deps, ctx, ids, { mapRows, naiveDatetimeZone })` (`changes/read-rows.ts`), which the change
feed now uses too — `getChanges` reports every id the read skipped as deleted.

### Index-friendly sort and filter (`sortExpr` / `filterExpr`)

A mapped column's `expr` is used verbatim in ORDER BY, the keyset predicate and WHERE. When it is an
expression (`JSON_EXTRACT(...)`, `CONCAT(...)`, `LOWER(...)`) no index can serve it, and MySQL sorts the
whole result set on every page (~2 s for a few thousand rows). Give the column an index-backed twin:

```ts
columns: {
  name: {
    expr: sql`JSON_UNQUOTE(JSON_EXTRACT(${leads.meta}, '$.name')) COLLATE utf8mb4_0900_as_ci`,
    sortExpr: leads.nameSort,     // ORDER BY + keyset paging + GROUP BY key
    filterExpr: leads.nameSort,   // WHERE (filters) + free-text search
  },
}
```

- `sortExpr` / `filterExpr` (`SQL | AnyColumn`, both optional, default `expr`) must produce the **same
  values and the same emptiness** as `expr` — same collation for text, NULL / blank exactly where `expr`
  is — or pages skip and repeat rows. The read projection keeps selecting `expr`.
- They go through the same pipeline as `expr`: drizzle columns are re-pointed at `sg_base` (so the base
  query must select them), and datetime kinds are wrapped in `CONVERT_TZ` for UTC comparison.
- `searchable` matches on `filterExpr` when given, else `expr`. Grouping keys use `sortExpr` (the key is
  grouped *and* ordered, so the sort-side index is the useful one); aggregations read `expr`.
- The same fields exist on `createMappedColumnResolver`'s `MappedColumn`; the translators ask for them via
  `resolveColumnExpr(column, scope, purpose)` (`"sort" | "filter" | "search" | "group" | "select"`). A
  custom `ColumnExprResolver.resolve` receives `purpose` as its optional third argument and may ignore it.

### Performance on existing tables

Hot sort / filter keys must be plain (or generated) columns with an index. For values that live in JSON:

```sql
ALTER TABLE leads
  ADD COLUMN name_sort VARCHAR(255) AS (JSON_UNQUOTE(JSON_EXTRACT(meta, '$.name'))) STORED,
  ADD INDEX idx_leads_name_sort (name_sort);
```

then point `sortExpr` / `filterExpr` at `leads.nameSort` (a `varchar("name_sort")` in the drizzle table;
`STORED` keeps the column in the base query's output, `VIRTUAL` also works when indexed). Check with

```sql
EXPLAIN SELECT ... FROM leads ORDER BY name_sort ASC, id ASC LIMIT 51;
```

`Extra` should not show `Using filesort` on the hot key (`Using index` / `Backward index scan` are fine).
Keyset paging (`page.cursor`) needs the sort key to be indexable: its predicate is
`(key > ? OR (key = ? AND id > ?))`, which is a range scan on an index over the key and a full scan over an
expression. Composite indexes covering the row-filter first (e.g. `(deleted_at, name_sort)`) help when the
base query always applies the same predicate.

The schema's `indexed` column option is **JSON-grid only**: it creates `gc_<key>` generated columns on the
grid rows table (`createDrizzleDataSource`), never on your table — for a SQL view, add the columns and
indexes yourself and wire them through `sortExpr` / `filterExpr`.

### Schema store availability (`schema.reason`, `schemaWritable`)

`capabilities.schema` says why `write` is false (v0.3.1; `reason` is absent when `write` is true):

| `reason` | when | `updateSchema` answers |
| --- | --- | --- |
| `no-store` | the grid has no `schemaStore` | `UNSUPPORTED_OPERATION` 501, `details: { reason: "schema-store-unavailable" }` |
| `store-unavailable` | `schemaStore.available()` is false — the Drizzle store's table was never created | same 501; the message names the grid and `createGridSchemasTableDDL` |
| `forbidden` | `permission(ctx, "updateSchema")` or `schemaWritable(ctx)` said no | `PERMISSION_DENIED` 403 |

Checks run in the usual order: unknown grid → unknown op → `permission` / `schemaWritable` (403) → store
availability (501) → input validation → the write. In the `capabilities` answer an unavailable store outranks a
forbidden caller.

- `defineGrid({ schemaWritable: (ctx) => boolean | Promise<boolean> })` — an extra gate on schema writes only,
  consulted besides `permission(ctx, "updateSchema")`; use it when `permission` is shared across ops and column
  editing needs a stricter rule (e.g. `schemaWritable: (ctx) => ctx.user.roles.includes("owner")`).
- `SchemaStore.available?(): Promise<boolean>` (core, optional; absent → assumed available). Evaluated at most
  once per request. `createMemorySchemaStore().available()` is always true. `createDrizzleSchemaStore` probes
  ``SELECT 1 FROM `table` LIMIT 0``: `ER_NO_SUCH_TABLE` → false, anything else rejects (not cached); `true` is
  cached for the store's lifetime and `false` is re-probed, so running the DDL later is picked up without a restart.
- While the store is unavailable the grid serves its base `schema` read-only (`getSchema` / `fetch` keep working;
  the stored schema is not read, so there is no `MISSING_TABLE` 500 on the read path). `get` / `put` outside the
  registry still throw `MissingTableError` (see *Missing tables*).

<!-- v0.3.1: further subsections go here -->

