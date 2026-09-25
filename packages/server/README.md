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
| `permission(ctx, op)` | gate for every op incl. `getSchema` / `updateSchema`; false → `PERMISSION_DENIED` 403. Default: allow all. |
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

Adapters (structural types, no framework dependency), all with the routes `POST /:gridId/:op`,
`GET /:gridId/schema` and `GET /` (list):

```ts
// Web Request → Response: Hono, Bun.serve, Next.js route handlers, Workers
const endpoint = toFetchHandler(grids, { basePath: "/api/grid", context: (request) => ctxFrom(request) });
app.all("/api/grid/*", (c) => endpoint(c.req.raw));

// Express middleware (unmatched paths go to next())
app.use("/api/grid", express.json(), toExpressRouter(grids, { context: (req) => ({ user: req.user }) }));

// API Gateway: POST /grid/{gridId}/{op}, GET /grid/{gridId}/schema (or GET /grid/{gridId}), GET /grid
export const handler = toLambdaHandler(grids, { context: (event) => ctxFromClaims(event) });
```

The browser side is `createGridClient({ baseUrl: "/api/grid", gridId })` from `@ranjeetk25/schema-grid-ag-grid`
(`{ dataSource, getSchema, updateSchema, capabilities }`).

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
