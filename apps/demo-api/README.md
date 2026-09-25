# demo-api

Hono + Bun demo backend for Schema Grid, on MySQL via `@ranjeetk25/schema-grid-server`.
It serves TWO grids through one `defineGrid` registry + `toFetchHandler` endpoint:

- `admissions` — core's JSON-cells fixture (r1..r5 on `grid_rows`), schema in `data/schema.json`
  ([`src/admissions-grid.ts`](src/admissions-grid.ts));
- `leads` — a SQL view over a plain `leads` table (1,200 seeded rows, no `cells` JSON)
  ([`src/leads/grid.ts`](src/leads/grid.ts), the ≤ 40-line example in `docs/consuming.md`).

The clock is pinned to `FIXTURE_NOW` so the spec §8 scenario is deterministic.

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
never had a row; it also creates `leads` and seeds it when empty. `POST /__reset` restores both.

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

`POST /grid/:gridId/:op`, `GET /grid/:gridId/schema` and `GET /grid` are the multi-grid endpoint
(`createGridRegistry` + `toFetchHandler`; browser: `createGridClient({ baseUrl: ".../grid", gridId })`).
Only admins (`x-roles: admin`) may `updateSchema` the leads grid; its schema store is in memory for now.

`POST /grid/:op` (legacy, the `admissions` grid) is the single-grid wire contract ([`docs/wire-contract.md`](../../docs/wire-contract.md)),
served by the same registry: the JSON body **is**
the op input, the answer is `200 { data }` or `<status> { error: { code, message, details? } }`.
The headers above become the adapter context (`{ user, now }`) that builds the per-request
Drizzle data source. The browser side is `createHttpDataSource({ baseUrl: ".../grid" })` from
`@ranjeetk25/schema-grid-ag-grid`.

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
| `POST /grid/:gridId/:op` | op input | `{ data }` (any op above, plus `getSchema` / `updateSchema`) |
| `GET /grid/:gridId/schema` | | `{ data: GridSchema }` |
| `GET /grid` | | `{ data: [{ id: "admissions" }, { id: "leads" }] }` |
| `GET /schema` | | `GridSchema` (admissions) |
| `PUT /schema` | `GridSchema` | new `GridSchema` (409 if `schemaVersion` is not current) |
| `POST /import` | multipart `file`, `grid?` (default `admissions`), `mapping?` (JSON header→columnId), `mode?` (`create`/`upsert`), `keyColumnId?` | 202 `{ jobId }` |
| `GET /import/:id` | | `{ state, processed, total, errorCount, errorReportUrl?, report? }` |
| `GET /import/:id/errors.csv` | | CSV of failed rows |
| `GET /export` | `grid` (default `admissions`), `format=csv\|xlsx`, `viewFilter`, `sort`, `columns` (URL-encoded JSON), `search`, `fileName` | file download |
| `POST /__reset` | | `{ ok: true }` |
| `GET /health` | | `{ ok: true }` |

Grid errors use the wire codes (`INPUT_INVALID` 400, `FILTER_INVALID` 400, `PERMISSION_DENIED` 403,
`UNKNOWN_OPERATION` 404, `UNSUPPORTED_OPERATION` 501, `INTERNAL` 500, ...). The other routes answer
`{ error: { name, message, details? } }` — 400 bad input / invalid filter, cursor, schema or row;
403 `PermissionError`; 404 unknown job; 409 stale schema; 500 otherwise.
