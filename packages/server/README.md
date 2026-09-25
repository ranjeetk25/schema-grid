# @masai/schema-grid-server

Node-side Schema Grid: schema validation, permission-checked MySQL queries via
Drizzle (`createDrizzleDataSource`), change feed, import/export jobs, DDL helpers
and transport-neutral HTTP adapters.

## Subpath exports

```
@masai/schema-grid-server         – errors, schema validation, access, cursors, import/export jobs (no drizzle at runtime)
@masai/schema-grid-server/drizzle – createDrizzleDataSource and the SQL translators
@masai/schema-grid-server/ddl     – table / generated-column DDL
@masai/schema-grid-server/http    – mount a DataSource behind any transport (below)
```

## Serving a grid (`./http`)

`createGridRouterAdapter` turns a `DataSource` — or a per-request factory that binds
the user — into one `handle(op, input, ctx)` function. Every transport is a few
lines around it; none is a dependency of this package.

```ts
import { createDrizzleDataSource } from "@masai/schema-grid-server/drizzle";
import { createGridRouterAdapter, toExpressHandler, toLambdaHandler } from "@masai/schema-grid-server/http";

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
from `@masai/schema-grid-ag-grid`.

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

`createDataSourceHandler` (from `@masai/schema-grid-core/wire`) is the same thing without the per-request
factory, if you already have a `DataSource` in hand.

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
import { alterRowsTableIdCollationDDL } from "@masai/schema-grid-server/ddl";

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
