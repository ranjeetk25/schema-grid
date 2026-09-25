# demo-api

Hono + Bun demo backend for Schema Grid, on MySQL via `@masai/schema-grid-server`.
It seeds core's admissions fixture (r1..r5) and pins the clock to `FIXTURE_NOW` so the
spec §8 scenario is deterministic.

## Run

```bash
docker compose up -d            # MySQL 8.4 on 127.0.0.1:3307 (repo root)
cd apps/demo-api
cp .env.example .env            # optional; defaults match docker-compose
bun run dev                     # http://localhost:3001 (watch mode); `bun run start` without watch
bun run typecheck
bun run test                    # unit tests; add SCHEMA_GRID_MYSQL_IT=1 for the MySQL/HTTP suite
```

Boot creates `grid_rows` / `grid_change_log` if missing, reconciles `gc_<key>` generated
columns against the last applied schema (`data/schema.json`), and seeds when the grid has
never had a row. `POST /__reset` restores the fixture.

Env: `PORT` (3001), `DATABASE_URL`, `DEMO_NOW` (ISO instant, default core `FIXTURE_NOW`;
`wall` = real clock), `DEMO_TZ` (`Asia/Kolkata`), `GRID_ID` (`admissions`).

## Request headers

| Header | Default | Meaning |
|---|---|---|
| `x-user` | `admin` | user id |
| `x-roles` | `admin` | comma-separated roles (`counsellor` hides Internal notes, makes Fee read-only) |
| `x-now` | `DEMO_NOW` | ISO instant for this request (e.g. reopen a view "the next day") |

CORS allows any origin and exposes `content-disposition`.

## Routes

`POST /grid/:op` is the wire contract ([`docs/wire-contract.md`](../../docs/wire-contract.md)),
served by `createGridRouterAdapter` from `@masai/schema-grid-server/http`: the JSON body **is**
the op input, the answer is `200 { data }` or `<status> { error: { code, message, details? } }`.
The headers above become the adapter context (`{ user, now }`) that builds the per-request
Drizzle data source. The browser side is `createHttpDataSource({ baseUrl: ".../grid" })` from
`@masai/schema-grid-ag-grid`.

| Route | Body / query | 200 response |
|---|---|---|
| `POST /grid/fetch` | `GridQuery` | `{ data: QueryResult }` |
| `POST /grid/applyChanges` | `ChangeBatch` | `{ data: ChangeResult }` |
| `POST /grid/createRows` | `{ partials }` | `{ data: GridRow[] }` |
| `POST /grid/deleteRows` | `{ ids }` | `{ data: null }` |
| `POST /grid/getChanges` | `{ since }` (`""` = current cursor) | `{ data: ChangeFeedEntry }` |
| `POST /grid/getOptions` | `{ columnId, search? }` | `{ data: Option[] }` |
| `POST /grid/createOption` | `{ columnId, label }` | `{ data: Option }` (schemaVersion bumped) |
| `POST /grid/lookup` | `{ columnId, search }` | `{ data: LinkRef[] }` |
| `GET /schema` | | `GridSchema` |
| `PUT /schema` | `GridSchema` | new `GridSchema` (409 if `schemaVersion` is stale) |
| `POST /import` | multipart `file`, `mapping?` (JSON header→columnId), `mode?` (`create`/`upsert`), `keyColumnId?` | 202 `{ jobId }` |
| `GET /import/:id` | | `{ state, processed, total, errorCount, errorReportUrl?, report? }` |
| `GET /import/:id/errors.csv` | | CSV of failed rows |
| `GET /export` | `format=csv\|xlsx`, `viewFilter`, `sort`, `columns` (URL-encoded JSON), `search`, `fileName` | file download |
| `POST /__reset` | | `{ ok: true }` |
| `GET /health` | | `{ ok: true }` |

Grid errors use the wire codes (`INPUT_INVALID` 400, `FILTER_INVALID` 400, `PERMISSION_DENIED` 403,
`UNKNOWN_OPERATION` 404, `UNSUPPORTED_OPERATION` 501, `INTERNAL` 500, ...). The other routes answer
`{ error: { name, message, details? } }` — 400 bad input / invalid filter, cursor, schema or row;
403 `PermissionError`; 404 unknown job; 409 stale schema; 500 otherwise.
