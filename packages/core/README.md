# @masai/schema-grid-core

Framework-free core of Schema Grid: schema and field types, filter AST, query model,
permissions, the formula engine, the `DataSource` contract, an in-memory reference
data source and the transport-neutral wire contract.

## Subpath exports

```
@masai/schema-grid-core              – schema, field-type ids, query/row/permission types, formulas, filters
@masai/schema-grid-core/field-types  – built-in field types and registries
@masai/schema-grid-core/filter       – filter AST, operators, validateFilter, resolveRelativeDate
@masai/schema-grid-core/formula      – parser, evaluator, dependency graph
@masai/schema-grid-core/memory       – createInMemoryDataSource (reference semantics)
@masai/schema-grid-core/testing      – fixture schema/rows used by every package's tests
@masai/schema-grid-core/wire         – run a DataSource across any transport (below)
```

## Running a DataSource over the network (`./wire`)

The grid only needs a `DataSource`. `./wire` splits one into a server half and a
client half that meet over **any** transport — tRPC, REST, Hono, Lambda, a worker
`postMessage` — without the grid knowing or caring. No transport is a dependency.

```ts
import { createDataSourceHandler, createRemoteDataSource, unwrapWireResult } from "@masai/schema-grid-core/wire";

// server: (op, untrustedInput) => { ok: true, data } | { ok: false, error, status }. Never throws.
const handle = createDataSourceHandler(dataSource, { validateOutput: process.env.NODE_ENV !== "production" });

// client: any (op, input) => Promise<output> function becomes a DataSource<GridRow>
const remote = createRemoteDataSource(async (op, input) => unwrapWireResult(await callServer(op, input)));
```

- `GRID_OPERATIONS` — the eight ops: `fetch`, `applyChanges`, `createRows`, `deleteRows`, `getChanges`,
  `getOptions`, `createOption`, `lookup`.
- `wireSchemas[op].input` / `.output` — Zod schemas (zod `^3.25 || ^4`). Multi-argument ops send named objects
  (`{ partials }`, `{ ids }`, `{ since }`, `{ columnId, search? }`, `{ columnId, label }`, `{ columnId, search }`);
  `deleteRows` answers `null`.
- `toWireError(err)` / `httpStatusFor(code)` — map thrown errors to `{ code, message, details? }` by duck-typing
  on `err.code` / `err.name` (server and in-memory errors included; unknown errors become `INTERNAL`, message
  hidden).
- `createDataSourceHandler(ds, { validateOutput?, exposeInternalErrors?, mapError?, onError? })` — validates
  input, calls `ds`, maps errors; a missing optional op answers `UNSUPPORTED_OPERATION` (501).
- `createRemoteDataSource(transport, { supports?, validateOutput? })` — validates responses (default on) and
  rethrows `WireError`s as `RemoteDataSourceError` (`code`, `status`, `details`). Optional ops exist only when
  `supports[op] !== false`.

Full list of codes, statuses and the HTTP binding: [`docs/wire-contract.md`](../../docs/wire-contract.md).
Ready-made HTTP pieces: `@masai/schema-grid-server/http` (server) and `createHttpDataSource` in
`@masai/schema-grid-ag-grid` (browser).
