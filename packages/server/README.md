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
app.post("/api/grid/:op", express.json(), toExpressHandler(grid, { context: (req) => ({ user: req.user }) }));
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

// Express middleware (unmatched paths go to next())
app.use("/api/grid", express.json(), toExpressRouter(grids, { context: (req) => ({ user: req.user }) }));

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
    update: async (ctx, { rowId, changes, baseVersion }) => { /* UPDATE … WHERE id = ? AND version = ? */ },
    create: async (ctx, partials) => { /* INSERT, return [{ id }] */ },
    delete: async (ctx, ids) => { /* DELETE / soft delete */ },
  },
  extension: createExtensionCellStore({ db, table: "grid_extension_cells" }), // optional
});
```

- **Base query.** Wrapped as the derived table `(<base>) AS sg_base` (MySQL merges it, so
  your indexes apply). Drizzle columns in `columns` / `rowId` / `version` / `updatedAt` are
  re-pointed at `sg_base` by column name, so the base must select them under their own
  names (no duplicate output names across joins — select explicit fields). `baseQuery`
  receives the request context (`ctx.user`, …), e.g. to scope rows per counsellor.
- **Semantics.** A mapped expression is compared as-is (like a physical column): text
  matching follows its collation — use `utf8mb4_0900_as_ci` for exact parity with core
  (case-insensitive, accent-sensitive); datetimes must be stored in UTC. `kind` overrides
  the storage kind, `searchable` the search participation.
- **Writes.** `applyChanges` validates, permission-checks (row-aware) and rejects
  `settable: false` columns ("Read-only"), compares the client's base version with the
  current row version, then calls `write.update` inside a transaction (`ctx.db` is the
  transaction). Return `{ conflict }` when your guarded UPDATE matched no row.
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

`compute(row)` runs after hydration on every read (`fetch`, `getChanges`, `createRows`). The column needs no
extension store, is read-only (writes answer "Column is read-only"), is excluded from free-text search and is
reported as neither sortable nor filterable in `capabilities` (`sort` / `filter` become explicit column-id
lists without it), so the grid turns those affordances off; the server rejects them anyway
(`UNSORTABLE_COLUMN` / `FILTER_INVALID`). Grouping by a computed column is a `FILTER_INVALID` 400.

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
