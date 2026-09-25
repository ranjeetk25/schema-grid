# Server integration testing (real MySQL 8.4)

`packages/server` has two test layers:

- **Unit** (`test/unit/**`): SQL is rendered against a fake mysql2 driver.
  These tests check the SQL *text*, not what MySQL does with it. They run in
  `bun run test`.
- **Integration** (`test/integration/*.int.test.ts`): runs the real
  `createDrizzleDataSource` against a throwaway `mysql:8.4` container started
  with `@testcontainers/mysql`. These tests are skipped unless
  `SCHEMA_GRID_MYSQL_IT=1` is set.

The integration suite is the executable check that the SQL adapter behaves
like core's in-memory datasource (`@masai/schema-grid-core/memory`). Core's
in-memory datasource defines schema-grid semantics.

## Running locally

Requirements: Docker running, plus `bun install` done.

```bash
bun run test:integration                      # from the repo root
cd packages/server && bun run test:integration  # or from the package
```

Both commands set `SCHEMA_GRID_MYSQL_IT=1` and run `vitest run test/integration`.

**Docker Desktop on macOS.** Testcontainers finds Docker through the default
socket (`/var/run/docker.sock`). If Docker Desktop has not linked that socket
(check "Allow the default Docker socket to be used" in Settings → Advanced),
point testcontainers at the per-user socket:

```bash
DOCKER_HOST=unix://$HOME/.docker/run/docker.sock bun run test:integration
```

Colima, OrbStack and Rancher Desktop need the same `DOCKER_HOST` override,
using their own socket path.

### Runtime

- **First run:** pulls `mysql:8.4` and the `testcontainers/ryuk` reaper, which
  takes a few minutes depending on your network.
- **Warm runs:** about 16–22 s wall time on an Apple-silicon laptop. Each of
  the four suite files starts its own container, and vitest runs the files in
  parallel. Container boot accounts for almost all of the time; the 34 tests
  themselves take milliseconds each.

The hook timeout for container start is 180 s (`beforeAll`), and the vitest
config's `hookTimeout` is 120 s.

## CI

The `server-integration` job in `.github/workflows/ci.yml` runs
`bun run test:integration` on `ubuntu-latest`, whose runners ship Docker.
Testcontainers starts MySQL there the same way it does locally.

- **On push to `main`:** always runs.
- **On pull requests:** runs only when `packages/server/**`,
  `packages/core/**`, `bun.lock` or the workflow file changed. The `changes`
  job uses `dorny/paths-filter` to check this.

## What each suite proves

### `harness.int.test.ts`

- The rows and change-log table DDL, plus the generated-column DDL, applies
  cleanly on MySQL 8.4.
- The fixture seeds through `createRows`.
- `idx_gc_fee` exists for the `indexed: true` column.
- The gating flag is a boolean. This last test is the only one that runs
  without Docker.

### `acceptance.int.test.ts`: §8 acceptance and in-memory parity

This suite uses the `@masai/schema-grid-core/testing` fixture (r1..r5) plus
the server rows r6/r7. The time zone is `Asia/Kolkata` and now is
`2026-09-25T00:30+05:30`.

- **§8 acceptance:** `payment_status isNot "Paid" AND call_date isWithin yesterday`
  returns exactly `r2, r3`.
  - `r3` has an **empty** status and must be included.
  - `r6` sits on the UTC-yesterday day but not on the IST-yesterday day, so it
    must be excluded.
  - The same saved view reopened 24 h later returns `r7`.
- **Parity table:** server ids *and order* equal the core in-memory datasource
  for the following cases:
  - text contains / notContains
  - number neq / between
  - select isNoneOf
  - multi hasNoneOf / hasAllOf
  - user isNotMe
  - boolean isFalse
  - date isBetween
  - datetime isWithin
  - nulls-last sort
  - **select sorts in both directions**, which use option order
- **Search** is case-insensitive.
- **Cursor paging:** keyset paging walks the full result with no duplicates or
  gaps. This holds for a mixed number/text sort and for a select sort
  (option-order keys).
- **Accent sensitivity:** text matching is case-insensitive but
  accent-sensitive, the same as core's `toLowerCase`. The suite checks this
  against the reference on dedicated rows (`José`/`JOSE`/`Renée`/`renee`).
- **Grouping:** counts, `sum` aggregates, group order and the empty-group key
  all equal the in-memory reference.
- **Formulas:**
  - A translatable formula (`balance`) filters in SQL, matches in-memory,
    including ÷0 and empty values, and raises no warning.
  - A non-translatable formula (`active_fee`) goes through the in-memory
    fallback, emits one `FORMULA_FALLBACK` warning, and matches in-memory.

### `conflicts-feed.int.test.ts`

- **Two-user version conflict:** B's stale base version produces a conflict
  entry with A's server value, `serverVersion: 2` and `updatedBy: A`. B's edit
  is not applied and gets **no `change_log` row**. A retry with the new base
  applies and bumps the version to 3.
- **Read-only column:** an edit to a read-only column is rejected with an
  error and the version does not change.
- **Change feed:**
  - one row per changed id
  - deleted ids go to `deletedRowIds`
  - columns hidden from the viewer are stripped
  - the cursor advances
- **Generated column:** `EXPLAIN` on `gc_fee = …` offers `idx_gc_fee`.

### `generated-columns.int.test.ts`

This suite indexes `name` (text) and the `balance` formula
(`{fee} - {paid}`), in addition to `fee`.

- `gc_fee`, `gc_name` and `gc_balance` columns are created, along with their
  `idx_gc_*` indexes.
- The **datasource's own SQL** filters on `gc_<key>`, and its `EXPLAIN` offers
  `idx_gc_<key>`. The suite captures the SQL with a drizzle logger.
- The **materialized formula** (`gc_balance`) filters and sorts exactly like
  core in-memory, including the empty and ÷0 rows, with no fallback warning.
- The indexed text column (`gc_name`) is case-insensitive and accent-sensitive,
  the same as the JSON path.

## Core semantics the SQL adapter must reproduce

The first real run of this suite found the following divergences. All of them
are fixed in the server package. Core was already correct.

| Area | Core (reference) | Server before | Fix |
|---|---|---|---|
| select/creatableSelect **sort** | option order (`compareByOptionOrder`); unknown ids after known ones, by code point | alphabetical (collation) | ORDER BY option rank `CASE`, then the `utf8mb4_bin` value. This adds two keyset keys (`src/sql/choice-order.ts`, `translate-sort.ts`). |
| select **group order** | option order | alphabetical | `MIN(rank)` / `MIN(binary value)` select fields, ordered after the empty flag |
| **empty group key** | `"∅"` | `"null"` (`JSON.stringify(null)`) | `EMPTY_GROUP_KEY = "∅"` |
| **sum** over a group with no numbers | `0` ("sum of nothing is 0") | `NULL` (SQL `SUM`) | `COALESCE(SUM(x), 0)`. `avg` stays `null`. |
| text **accents** | `toLowerCase()`: case-insensitive, accent-sensitive | `utf8mb4_0900_ai_ci`, which also folds accents (`jose` matched `José`) | `TEXT_COLLATION = utf8mb4_0900_as_ci` |
| indexed text `gc_<key>` | same as above | the column inherited the table default collation (comparisons use the *column* collation, not the `COLLATE` inside the generation expression) | text/choice/ref gc columns declare `CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci`. The rows-table default is `as_ci` too. Row `id` stays `utf8mb4_bin`. |

### Known residual differences (not covered by the fixture)

- **Text sort:** core uses `Intl.Collator({ sensitivity: "base", numeric: true })`,
  which is accent-*insensitive* and numeric-aware (`item2 < item10`). MySQL
  orders by `utf8mb4_0900_as_ci`, so values that differ only by accents or by
  embedded numbers can order differently.
- **User sort:** core orders by `name` (lowercased), then id. SQL orders by
  `owner.id`. The two orders agree on the fixture.
- **Text grouping:** core buckets by the exact value. SQL groups
  case-insensitively, so `"Asha"` and `"asha"` form one group.
- **Collation folding:** `as_ci` still treats a few characters as equal that
  `toLowerCase` does not (for example `ß` and `ss`).
- **Physical `source.valueField` columns** that the consumer creates keep
  their own collation.

### Upgrading existing tables

Tables created before the collation change still have `ai_ci` defaults and
`ai_ci` `gc_*` text columns. The JSON path changes behaviour immediately,
because the collation is applied in the expression. To make indexed text
columns match, recreate their generated columns: drop and re-add through
`diffIndexedColumns`, or run
`ALTER TABLE … MODIFY gc_<key> VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci GENERATED ALWAYS AS (…) VIRTUAL`.
