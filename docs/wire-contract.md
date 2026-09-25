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
```

- Core: `@masai/schema-grid-core/wire` (`GRID_OPERATIONS`, `wireSchemas`, `createDataSourceHandler`,
  `createRemoteDataSource`, `toWireError`, `httpStatusFor`, `RemoteDataSourceError`, `unwrapWireResult`).
- Server: `@masai/schema-grid-server/http` (`createGridRouterAdapter`, `toExpressHandler`, `toLambdaHandler`,
  `toHttpResponse`).
- Browser: `@masai/schema-grid-ag-grid` (`createHttpDataSource`, re-exported `createRemoteDataSource`).

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
| `UNKNOWN_OPERATION` | 404 | `op` is not one of the eight operations |
| `FORMULA_ROW_CAP` | 413 | filter/sort on a non-SQL formula column exceeded `formulaFallbackRowCap` |
| `INTERNAL` | 500 | anything unrecognised (message hidden unless `exposeInternalErrors`) |
| `OUTPUT_INVALID` | 500 | a response failed its output schema (server with `validateOutput`, or the client) |
| `UNSUPPORTED_OPERATION` | 501 | the data source does not implement an optional operation |

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

- `POST {base}/{op}` with a JSON body = the op input (`content-type: application/json`).
- Success: `200 { "data": <output> }`.
- Failure: `<status from the table> { "error": WireError }`.

Any other transport can carry the same `WireResult` envelope
(`{ ok: true, data } | { ok: false, error, status }`) and unwrap it on the client with `unwrapWireResult`.
