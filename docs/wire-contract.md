# Schema Grid wire contract

The grid only talks to a `DataSource` (spec §4.6). The wire contract lets that
data source live on a server behind **any** transport — tRPC, plain REST/Express,
Hono, AWS API Gateway + Lambda — with no grid changes. Nothing in the grid or the
contract depends on a specific framework.

```
browser                                     server
SchemaGrid ── DataSource ── transport ──►  handler(op, input) ── DataSource (drizzle / in-memory / yours)
            createRemoteDataSource          createDataSourceHandler
            createHttpDataSource            createGridRouterAdapter + toExpressHandler / toLambdaHandler
            createGridClient                createGridRegistry(defineGrid…) + toFetchHandler / toExpressRouter / toLambdaHandler
```

- Core: `@ranjeetk25/schema-grid-core/wire` (`GRID_OPERATIONS`, `wireSchemas`, `createDataSourceHandler`,
  `createRemoteDataSource`, `toWireError`, `httpStatusFor`, `RemoteDataSourceError`, `unwrapWireResult`).
- Server: `@ranjeetk25/schema-grid-server/http` (`defineGrid`, `createGridRegistry`, `toFetchHandler`,
  `toExpressRouter`, `createGridRouterAdapter`, `toExpressHandler`, `toLambdaHandler`, `toHttpResponse`).
- Browser: `@ranjeetk25/schema-grid-ag-grid` (`createGridClient`, `createHttpDataSource`, re-exported
  `createRemoteDataSource`).

## Operations

Every operation takes one JSON value and returns one JSON value. Schemas are Zod
(`wireSchemas[op].input` / `.output`), compatible with zod `^3.25` and `^4`.

| op | optional | input | output |
|---|---|---|---|
| `fetch` | | `GridQuery` | `QueryResult<GridRow>` |
| `applyChanges` | | `ChangeBatch` | `ChangeResult` (version conflicts are data, not errors) |
| `createRows` | | `{ partials: RowPartial[] }` | `GridRow[]` |
| `deleteRows` | | `{ ids: string[] }` | `null` |
| `getChanges` | yes | `{ since: string }` | `ChangeFeedEntry<GridRow>` |
| `getOptions` | yes | `{ columnId: string, search?: string }` | `Option[]` |
| `createOption` | yes | `{ columnId: string, label: string }` | `Option` |
| `lookup` | yes | `{ columnId: string, search: string }` | `LinkRef[]` |
| `getRows` | yes | `{ ids: string[] }` | `GridRow[]` (v0.3.1: the current rows, projected for the caller, formulas / computed columns evaluated; unknown or invisible ids skipped; order follows `ids`) |
| `getSchema` | grid | `null` | `GridSchema` |
| `updateSchema` | grid | `GridSchema` (with the current `schemaVersion`) | `GridSchema` (stored, `schemaVersion` + 1) |

`GRID_OPERATIONS` is a set, not an ordered list: newer versions append operations. The **grid** operations
(`GRID_SCHEMA_OPERATIONS`) are answered by a grid registry (`createGridRegistry`), not by a `DataSource`; a bare
`createDataSourceHandler` answers them with `UNSUPPORTED_OPERATION`. `gridSchemaSchema` checks the structure only
(unknown column / view keys are kept); `updateSchema` is validated semantically by the server's
`assertValidSchema`.

Notes:

- `GridRow.cells` is `Record<string, unknown>`; cell values are validated by the data source, not the wire.
- `FilterNode` is recursive; the wire does **not** enforce the depth limit — the data source does (and answers
  `FILTER_INVALID`).
- `page` is exactly one of `{ offset, limit }` or `{ cursor, limit }` (`limit` a positive integer, `offset` a
  non-negative integer); objects carrying both are rejected.
- Unknown object keys in inputs are stripped before the data source sees them.

## Errors

A failed operation yields `WireError { code: string; message: string; details?: unknown }` plus an HTTP status.
`details` is always JSON-safe (non-serialisable details are dropped).

| code | status | raised when |
|---|---|---|
| `INPUT_INVALID` | 400 | input fails the op schema; unknown column / bad page / bad option label / wrong column type |
| `FILTER_INVALID` | 400 | malformed filter AST, or the data source rejects the filter (unknown/unreadable column, operator, value kind, depth) |
| `INVALID_CURSOR` | 400 | stale or malformed page / change-feed cursor |
| `SCHEMA_INVALID` | 400 | server `SchemaValidationError` |
| `ROW_INVALID` | 400 | `createRows` partial rejected (server `RowValidationError`, `InMemoryMutationError`) |
| `GROUPING_INVALID` | 400 | invalid `groupBy` / aggregation |
| `UNAUTHENTICATED` | 401 | thrown by your context/data-source factory (`{ code: "UNAUTHENTICATED" }`) |
| `PERMISSION_DENIED` | 403 | column/row permission check failed |
| `UNKNOWN_OPERATION` | 404 | `op` is not a wire operation (or no grid route matches the path) |
| `UNKNOWN_GRID` | 404 | multi-grid endpoint: no grid registered under that id |
| `METHOD_NOT_ALLOWED` | 405 | multi-grid endpoint: e.g. `PUT` on an op path |
| `SCHEMA_CONFLICT` | 409 | `updateSchema` with a stale `schemaVersion` (`details.currentVersion`) |
| `FORMULA_ROW_CAP` | 413 | filter/sort on a non-SQL formula column exceeded `formulaFallbackRowCap` |
| `INTERNAL` | 500 | anything unrecognised (message hidden unless `exposeInternalErrors`) |
| `OUTPUT_INVALID` | 500 | a response failed its output schema (server with `validateOutput`, or the client) |
| `UNSUPPORTED_OPERATION` | 501 | the data source does not implement an optional operation; `updateSchema` on a grid without a schema store |

Clients may also see `HTTP_ERROR` (with the real HTTP status) from `createHttpDataSource` when a non-2xx
response carries no `WireError` body (proxy/gateway errors).

`toWireError` duck-types on `err.code` first, then `err.name`, so core never imports the server:

| source | wire code |
|---|---|
| server `PERMISSION_DENIED` / `PermissionError` | `PERMISSION_DENIED` |
| server `INVALID_FILTER`, `UNSUPPORTED_OPERATOR` | `FILTER_INVALID` |
| server `INVALID_CURSOR` / `CursorError` | `INVALID_CURSOR` |
| server `INVALID_SCHEMA` / `SchemaValidationError` | `SCHEMA_INVALID` |
| server `FORMULA_QUERY_LIMIT` / `FormulaQueryLimitError` | `FORMULA_ROW_CAP` |
| server `GROUPING_ERROR`, `INVALID_ROW` | `GROUPING_INVALID`, `ROW_INVALID` |
| in-memory `InMemoryQueryError` with filter errors | `FILTER_INVALID` (`details: { reason, errors }`) |
| in-memory `notEditable`, `unreadableColumn` | `PERMISSION_DENIED` |
| in-memory `invalidCursor`, `invalidAggregation` | `INVALID_CURSOR`, `GROUPING_INVALID` |
| any error whose `code` already is a wire code | passed through |
| everything else | `INTERNAL` |

Override or extend with `createDataSourceHandler(ds, { mapError })`.

## HTTP binding

Used by `toExpressHandler`, `toLambdaHandler`, `toHttpResponse` and `createHttpDataSource`:

- `POST {base}/{op}` with a JSON body = the op input (`content-type: application/json`). A `null` input
  (`capabilities`, `getSchema`) is sent as a **body-less** POST without `content-type` (v0.3 client); servers
  read a missing / empty / `{}` / raw `"null"` body as `null` for those ops only. Objects and arrays are sent
  as-is, so `express.json()` in strict mode accepts them; use `express.json({ strict: false })` on the grid
  path for older clients that post a bare `null`.
- Success: `200 { "data": <output> }`.
- Failure: `<status from the table> { "error": WireError }`.

Any other transport can carry the same `WireResult` envelope
(`{ ok: true, data } | { ok: false, error, status }`) and unwrap it on the client with `unwrapWireResult`.

## Multi-grid endpoint

A grid registry (`createGridRegistry([defineGrid(…), …])`) serves many grids behind one base URL. Used by
`toFetchHandler`, `toExpressRouter`, `toLambdaHandler(registry, …)` and `createGridClient`:

| route | op | body |
|---|---|---|
| `POST {base}/{gridId}/{op}` | any wire op, incl. `getSchema` (empty body) and `updateSchema` | the op input (an empty body is `null`) |
| `GET {base}` | list | — → `200 { data: [{ id }] }` (grids whose `getSchema` the caller may run) |

There is exactly one way to read a grid's schema: the `getSchema` op (`POST {base}/{gridId}/getSchema`).
v0.3 removed the `GET {base}/{gridId}/schema` alias (it now answers `405 METHOD_NOT_ALLOWED`).

`capabilities` on a registry grid carries `schema: { read, write }` (v0.3): `read` = the caller passes
`permission(ctx, "getSchema")`, `write` = the grid has a `schemaStore` AND the caller passes
`permission(ctx, "updateSchema")`. Clients hide every column-editing entry point when `write` is false.

`ChangeBatch.meta` and `CellChange.meta` (v0.3) carry JSON side data that is never a cell value (e.g. a
decision message a `beforeCellsChange` hook attached). Servers ignore it for validation, hand it to the write
hooks and echo it on the matching `applied` / `conflicts` entry; `ChangeResult.rejected` (v0.3) lists changes
a source declined quietly (not applied, not an error).

v0.3.1 additions (all optional, all passthrough — a v0.3 peer simply ignores them):

- `ChangeResult.rows?: GridRow[]` — the refreshed rows for every row id in the batch that still exists, read
  AFTER the write (formulas, `compute`, `mapRows` and projection applied). The in-memory source and both server
  sources populate it; clients upsert these rows and skip the post-save `getRows` when they are present.
- `ChangeBatch.resubmitOf?: string` — the id of the batch this one re-submits (a conflict "Overwrite"). Set by
  the client's edit controller; the original batch's `meta` is carried onto the re-submit. Hosts use it to skip a
  confirmation they already gave (the workbench does so unless `confirmOnResubmit`).
- `getRows` (table above) — the operation clients call to refresh rows when `rows` is absent
  (`refetchAfterSave`) or on demand (`handle.refreshRows(ids)`). A source without it answers `UNSUPPORTED_OPERATION`
  501; there is deliberately no capabilities flag for it.
- `capabilities.schema.reason?: "forbidden" | "no-store" | "store-unavailable"` — why `schema.write` is false. A
  grid registry answers `no-store` (no `schemaStore`), `store-unavailable` (`SchemaStore.available()` is false —
  e.g. the Drizzle store's table was never created) or `forbidden` (`permission(ctx, "updateSchema")` /
  `schemaWritable(ctx)` said no). `updateSchema` on a missing / unavailable store is `UNSUPPORTED_OPERATION` 501
  with `details.reason: "schema-store-unavailable"`, not 403.
- `Option.settableMessage?: string` on `getOptions` / `createOption` answers and inside schemas: the message
  shown instead of the generated "Option “X” can only be set by …" / "can’t be set manually".

Checks run in this order: unknown grid (`UNKNOWN_GRID` 404) → unknown op (`UNKNOWN_OPERATION` 404) →
`permission(ctx, op)` (`PERMISSION_DENIED` 403) → input validation → the operation. Responses use the same
`200 { data }` / `<status> { error }` envelope. The single-grid binding above (`POST {base}/{op}`) is unchanged.

