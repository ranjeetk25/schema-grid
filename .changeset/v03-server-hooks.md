---
"@ranjeetk25/schema-grid-core": minor
"@ranjeetk25/schema-grid-ag-grid": minor
"@ranjeetk25/schema-grid-server": minor
"@ranjeetk25/schema-grid-io": minor
"@ranjeetk25/schema-grid-ui-mantine": minor
"@ranjeetk25/schema-grid-ui-shadcn": minor
---

v0.3 — server hooks and time zones (integration findings).

**SQL view: per-cell write outcomes**

- `write.update` answers any subset of `{ applied, rejected, errors, conflict, version }` (`SqlViewUpdateOutcome`): `errors` → `ChangeResult.errors`, `rejected` → `ChangeResult.rejected`, cells the hook mentions nowhere count as `rejected`, applied cells bump the row version once (`version`, or a re-read when omitted), nothing applied → no `versions` entry. `write.create(ctx, partials, storage)` may answer `{ rows, errors: [{ index, columnId?, message }] }` → `RowValidationError` (`ROW_INVALID` 400), transaction rolled back.

**Post-read hook, computed columns, default sort**

- `RowSource.mapRows` (server): a batched hook after hydration and formula evaluation, before projection, on fetch (SQL and formula fallback), the change feed and `createRows`. `createSqlViewDataSource` / `createDrizzleDataSource` take `mapRows(rows, ctx)` / `mapRow(row, ctx)` (e.g. signing file URLs; hidden cells are visible to the hook, every mapped column is selected when a hook is configured).
- `createSqlViewDataSource` `columns[key].compute?` runs after formulas and before `mapRows`; `computed: { key: { kind } }` declares mapRows-only columns. Both are unsortable, unfilterable, unsearchable and read-only (`isComputedColumn`).
- `defaultSort: SortSpec[]` on both sources: applied when a query has `sort: []` (also the keyset tie-break), reported as `DataSourceCapabilities.defaultSort` (new optional core field, passed through `normalizeCapabilities` / `mergeCapabilities`). `createDrizzleDataSource` now implements `capabilities()`.

**Bare JSON bodies vs `express.json()`**

- ag-grid `createHttpDataSource` / `createGridClient` send `null` inputs (`capabilities`, `getSchema`) as a body-less POST without `content-type`; arrays and objects are unchanged.
- server `toExpressRouter` / `toExpressHandler` read a missing / empty / `{}` / raw `"null"` body as `null` for the null-input ops (`normalizeRequestBody`, `isNullInputOperation` in `/http`). Docs: mount the grid router before the global `express.json()` or use `express.json({ strict: false })`.

**Naive dates read as UTC**

- SQL view: `date` columns are read as `DATE_FORMAT(col, '%Y-%m-%d')` (never a zone-shifted `Date`); `datetime` columns as naive wall times interpreted in **`naiveDatetimeZone`** (new option, default = `tz`) into UTC ISO, compared in UTC via `CONVERT_TZ` for filters / sorts / cursors, and written back as wall time: the write hooks receive storage-ready `values` (update) / `storage` (create). **Behaviour change:** DATETIME columns that store UTC must set `naiveDatetimeZone: "UTC"`.
- `hydrateRow(dbRow, schema, registry, { naiveDatetimeZone })`, `dateOnlyFromDriver`, `naiveDatetimeToIso`, `isoToNaiveDatetime` exported from `/drizzle`; `createDrizzleDataSource({ naiveDatetimeZone })` for physical datetime columns (reads).
- core: `date.parse(Date)` reads the calendar day in `DateConfig.timeZone` (default `Asia/Kolkata`) instead of `toISOString()`; `datetime.parse` accepts `YYYY-MM-DD HH:MM:SS[.fff]` as a wall time in `config.timeZone`.
