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
