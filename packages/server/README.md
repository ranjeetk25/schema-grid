# @ranjeetk25/schema-grid-server

Node-side Schema Grid: schema validation, permission-checked MySQL queries via
Drizzle (`createDrizzleDataSource`), change feed, import/export jobs, DDL helpers
and transport-neutral HTTP adapters.

## Subpath exports

```
@ranjeetk25/schema-grid-server         – errors, schema validation, access, cursors, import/export jobs (no drizzle at runtime)
@ranjeetk25/schema-grid-server/drizzle – createDrizzleDataSource and the SQL translators
@ranjeetk25/schema-grid-server/ddl     – table / generated-column DDL
@ranjeetk25/schema-grid-server/http    – mount a DataSource behind any transport (below)
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
