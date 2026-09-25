# Schema Grid v1 — Design Spec

Status: approved for planning (2026-09-25)

## 1. Problem

Admissions tooling needs an Airtable-style grid: admins create columns at runtime (columns are DATA, persisted as JSON), pick a field type per column, set column-level access, filter across columns with compound conditions, edit inline (single cell and ranges), import/export, group, use formula columns, and see teammates' edits without stepping on them.

No off-the-shelf React component does runtime columns + permissions + field-type plugins. We build a thin, schema-driven layer on top of a grid engine.

## 2. Locked decisions

| Decision | Choice | Why |
|---|---|---|
| Engine | **AG Grid Community** (`ag-grid-community`, `ag-grid-react` ^36) as **peer dependency**. No fork, no vendoring, never reference Enterprise source. | MIT, mature, public extension points for editors/filters/datasource. |
| Enterprise-only gaps we build ourselves | range selection, multi-cell clipboard, fill handle, row grouping, XLSX export, compound (cross-column OR) filter builder, set filter, rich/creatable select editor | Community lacks these; implemented from scratch on documented public APIs only. |
| Repo | separate repo `~/Desktop/workspace/masai/schema-grid`, bun workspaces, `main` branch | Reusable across Masai apps. |
| UI kit | **Mantine v8** (peer `^8`) | Matches `public-ui` (8.3.x). |
| Backend reference | **Drizzle ORM + MySQL** (`/server` package) | Matches admissions API. |
| Multi-user | **Simplest**: optimistic version checks on write + HTTP polling change feed. NO WebSocket, NO CRDT, NO live cursors, NO cell locks. | Explicit user decision. |
| Formulas | **Formula columns** (Airtable-style, one expression per column, `{columnKey}` refs). NO A1 cell formulas. MIT parser written in-house. NO HyperFormula (GPL). | A1 refs break under server paging/sort. |
| Import | CSV/XLSX wizard; large files processed server-side as a job | |
| Export | CSV + XLSX, respects permissions and current view | |
| Validation lib | Zod (peer `^3.25 \|\| ^4`) | Type configs + column builder forms share schemas. |
| Timezone | Relative dates resolved server-side at query time in configurable TZ, default `Asia/Kolkata` | |
| Plans style | Design-only: file paths + acceptance criteria. No code snippets in plans. | User preference. |

## 3. Packages (bun workspaces)

```
schema-grid/
  packages/
    core/           @ranjeetk25/schema-grid-core      — schema, field-type registry, filter AST, query model,
                                                    permissions, formula engine, change/patch model.
                                                    ZERO deps on React, AG Grid, Mantine, Drizzle.
    server/         @ranjeetk25/schema-grid-server    — filter AST → Drizzle/MySQL, permission enforcement,
                                                    schema validation, formula evaluation, grouping
                                                    queries, change-feed cursor, import/export jobs.
                                                    Node only. Depends on core.
    ag-grid/        @ranjeetk25/schema-grid-ag-grid   — schema→ColDef compiler, custom editors/filters/
                                                    renderers, infinite datasource adapter, range
                                                    selection, clipboard, fill handle, undo/redo,
                                                    client-side grouping, polling sync.
                                                    Peer: react, ag-grid-community, ag-grid-react.
    ui-mantine/     @ranjeetk25/schema-grid-ui-mantine — column builder, filter builder, chips, view
                                                    switcher, import wizard, export dialog, conflict
                                                    prompt, Mantine-based editor widgets.
                                                    Peer: react, @mantine/core ^8, @mantine/hooks,
                                                    @mantine/dates, dayjs.
    import-export/  @ranjeetk25/schema-grid-io        — CSV/XLSX parse + generate (Papaparse, ExcelJS),
                                                    column auto-mapping, row validation via field types.
                                                    Isomorphic (browser preview + server job).
  apps/
    storybook/      Stories for every field type, permission state, server mode, import/export.
    demo-api/       Minimal Express + tRPC + Drizzle + MySQL (docker) proving /server end to end.
  docs/
    superpowers/specs/   this file
    superpowers/plans/   one plan per package
```

Dependency graph: `core` ← `server`, `ag-grid`, `ui-mantine`, `import-export`. `ui-mantine` ← `ag-grid` (for editor registration), `import-export`. Nothing depends on `server` except `demo-api`.

## 4. Core contract (names are binding for all packages)

### 4.1 Schema
- `GridSchema { id, schemaVersion: number, columns: ColumnDef[], views?: ViewDef[] }`
- `ColumnDef { id, key, label, type: FieldTypeId, config: unknown (validated by type's Zod schema), required?, defaultValue?, validation?, permissions?: ColumnPermissions, width?, pinned?: "left"|"right"|null, hidden?, order, indexed?, formula?: string (only when type==="formula"), source?: { valueField } (maps to existing DB column), createdAt, updatedAt }`
- `ColumnPermissions { read: RoleRule, edit: RoleRule }` where `RoleRule = "all" | { roles: string[] }`.
- `ViewDef { id, name, filter: FilterNode|null, sort: SortSpec[], search?: string, columnState: { id, hidden, width, pinned, order }[], groupBy: GroupSpec[], pageSize }`
- `migrateSchema(schema, migrations)` runs ordered `schemaVersion` migrations.

### 4.2 Field types
- `FieldTypeId` = built-in union + `string` for custom.
- Built-ins: `text`, `longText`, `number`, `currency`, `boolean`, `date`, `datetime`, `select`, `multiSelect`, `creatableSelect`, `user`, `url`, `email`, `phone`, `link`, `formula`.
- `FieldType<TValue, TConfig>`:
  - `id`, `label`, `configSchema: ZodSchema<TConfig>`, `defaultConfig`
  - `valueSchema(config): ZodSchema<TValue>` (validation)
  - `parse(input: unknown, config): ParseResult<TValue>` (clipboard/import text → value; never throws)
  - `format(value, config): string` (display + clipboard/export text)
  - `serialize(value)/deserialize(raw)` (JSON storage form)
  - `compare(a, b, config): number` (sort)
  - `operators: FilterOperatorDef[]` (each: `id`, `label`, `valueKind: "none"|"single"|"multi"|"range"|"relativeDate"|"me"`, `negative?: boolean`)
  - `fillSeries?(values: TValue[], count): TValue[]` (fill handle pattern continuation; number/date only)
  - `aggregations?: AggregationId[]` (for grouping)
  - `defaultValue(config)`
- `FieldTypeRegistry`: `register(type)`, `get(id)`, `list()`, `has(id)`. `createDefaultRegistry()` returns registry with all built-ins.
- UI pieces (renderer/editor/filter input) are NOT in core; `ag-grid` and `ui-mantine` keep parallel registries keyed by the same `FieldTypeId`.

### 4.3 Filter AST
- `FilterNode = FilterGroup | FilterCondition`
- `FilterGroup { op: "and"|"or", children: FilterNode[] }` — max nesting depth 2 (group inside root group).
- `FilterCondition { columnId, operator: string, value?: FilterValue }`
- `FilterValue` = primitive | primitive[] | `{ from, to }` | `RelativeDate` | `{ me: true }`
- `RelativeDate = { relative: "today"|"yesterday"|"tomorrow"|"thisWeek"|"lastWeek"|"thisMonth"|"lastMonth"|"lastNDays"|"nextNDays", n?: number }`
- `validateFilter(node, schema, registry, readableColumnIds)` → typed errors: unknown column, unreadable column, unknown operator for type, depth exceeded, value kind mismatch.
- `resolveRelativeDate(rd, now, tz)` → `{ from: ISO, to: ISO }` (half-open `[from, to)`). Lives in core (pure), used by server.
- Operators per type (ids):
  - select/creatableSelect/user: `is`, `isNot`, `isAnyOf`, `isNoneOf`, `isEmpty`, `isNotEmpty`; user adds `isMe`, `isNotMe`
  - multiSelect: `hasAnyOf`, `hasAllOf`, `hasNoneOf`, `isEmpty`, `isNotEmpty`
  - date/datetime: `is`, `isBefore`, `isAfter`, `isBetween`, `isWithin`(relativeDate), `isEmpty`, `isNotEmpty`
  - number/currency: `eq`, `neq`, `lt`, `lte`, `gt`, `gte`, `between`, `isEmpty`, `isNotEmpty`
  - text/longText/url/email/phone: `contains`, `notContains`, `startsWith`, `is`, `isNot`, `isEmpty`, `isNotEmpty`
  - boolean: `isTrue`, `isFalse`
  - link: `is`, `isAnyOf`, `isEmpty`, `isNotEmpty`
  - formula: operators of its result type
- **Null semantics**: every operator flagged `negative: true` (isNot, isNoneOf, notContains, neq, hasNoneOf, isNotMe) MATCHES empty values. Positive operators never match empty. Translators emit `(col <> ? OR col IS NULL)`.

### 4.4 Query model
- `GridQuery { filter: FilterNode|null, sort: SortSpec[], search?: string, groupBy?: GroupSpec[], page: { offset, limit } | { cursor, limit }, includeTotal?: boolean }`
- `SortSpec { columnId, dir: "asc"|"desc" }`
- `GroupSpec { columnId, aggregations?: { columnId, agg: AggregationId }[] }`
- `AggregationId = "count"|"sum"|"avg"|"min"|"max"|"countEmpty"|"countFilled"`
- `QueryResult<Row> { rows: Row[], total?: number, nextCursor?: string, groups?: GroupResult[] }`

### 4.5 Rows, changes, versions
- `GridRow { id: string, version: number, updatedAt: ISO, updatedBy?: ActorRef, cells: Record<columnKey, unknown> }`
- `CellChange { rowId, columnId, prev, next }`
- `ChangeBatch { id: string, changes: CellChange[], baseVersions: Record<rowId, number>, source: "edit"|"paste"|"fill"|"undo"|"redo"|"import" }`
- `ChangeResult { applied: CellChange[], conflicts: { rowId, columnId, serverValue, serverVersion, updatedBy, updatedAt }[], errors: { rowId, columnId, message }[] }`
- `ChangeFeedEntry { cursor: string, rows: GridRow[], deletedRowIds: string[], schemaVersion: number }`

### 4.6 Data source (implemented by consumers; adapters provided)
- `DataSource<Row> { fetch(query): Promise<QueryResult<Row>>, applyChanges(batch): Promise<ChangeResult>, createRows(partials[]): Promise<Row[]>, deleteRows(ids[]): Promise<void>, getChanges?(since: cursor): Promise<ChangeFeedEntry>, getOptions?(columnId, search?): Promise<Option[]>, createOption?(columnId, label): Promise<Option>, lookup?(columnId, search): Promise<LinkRef[]> }`

### 4.7 Permissions
- `PermissionContext { user: { id, roles: string[] }, column: ColumnDef, row?: GridRow }`
- `PermissionResolver = (ctx) => "hidden"|"read"|"edit"`
- `createRolePermissionResolver()` — default implementation from `ColumnPermissions`.
- `resolveColumnAccess(schema, resolver, user)` → `Map<columnId, Access>` (row-independent pass).
- Hidden columns: excluded from fetch projection, filters, sort, groupBy, export, clipboard.

### 4.8 Formula engine
- Grammar: numbers, strings, booleans, `{columnKey}` refs, `+ - * / %`, comparisons, `&&`/`||`/`!`, ternary via `IF()`, function calls, parentheses.
- Function library v1: `IF, AND, OR, NOT, SUM, AVG, MIN, MAX, ROUND, ABS, CONCAT, UPPER, LOWER, TRIM, LEN, LEFT, RIGHT, TODAY, NOW, DATEADD, DATEDIFF, YEAR, MONTH, DAY, IS_EMPTY, COALESCE`.
- API: `parseFormula(src)` → AST or `FormulaError`; `inferResultType(ast, schema)` → `"number"|"text"|"boolean"|"date"`; `evaluate(ast, row, schema, env{now,tz})`; `dependencies(ast)` → columnKeys; cycle detection across formula columns.
- Formula columns are read-only. Client recomputes on dependency change; server evaluates for filter/sort in server mode.

### 4.9 Events (emitted by `ag-grid` layer; typed in core)
`beforeCellsChange(batch) → batch | false` (async), `onCellsChange(result)`, `onRowsCreate`, `onRowsDelete`, `onColumnCreate/Update/Delete`, `onOptionCreate`, `onViewChange`, `onConflict`, `onRemoteChanges`.

## 5. Feature-to-package map

| # | Feature | core | server | ag-grid | ui-mantine | import-export |
|---|---|---|---|---|---|---|
| 2 | Column schema, versioning, migrations | ✔ | validate | compile→ColDef | builder | |
| 3 | 16 field types | ✔ | | renderer+editor per type | editor widgets | parse via core |
| 4 | Filter AST, operators, relative dates, null semantics, builder UI, hidden-column rejection | ✔ | translate+reject | per-column filter comps | builder + chips | |
| 5 | Sort, offset/cursor paging, client + infinite server mode | query model | translate | datasource adapter | | |
| 6 | Column permissions | resolver | enforce | compile into editable/hide | | export honours |
| 7 | Editing, events, optimistic + rollback | change model | applyChanges | ✔ | conflict prompt | |
| 8 | Saved views, column state | ViewDef | | apply/capture | view switcher | |
| 9 | Column builder | | | | ✔ | |
| 10 | A11y, keyboard, theming, Mantine-in-editor portal fix | | | ✔ | ✔ | |
| 12 | Range select, multi-cell copy/paste, fill handle | parse/format | | ✔ | | |
| 13 | Undo/redo | | | ✔ | | |
| 14 | Formula columns | ✔ | evaluate/materialize | render | formula editor w/ autocomplete | |
| 15 | Import wizard | | job runner | | wizard UI | ✔ |
| 16 | Export CSV/XLSX | | job for large | current-view export | dialog | ✔ |
| 17 | Grouping + aggregates | GroupSpec | grouping SQL | client grouping render | group bar | |
| 18 | Multi-user (version check + polling) | change/feed types | version guard + feed | poller + patcher | conflict prompt | |

## 6. Not in v1
Pivot, charts, offline, A1 formulas, comments/threads, WebSocket/SSE, CRDT, live cursors, cell locks, Excel import of formulas.

## 7. Cross-cutting requirements
- TypeScript strict; no `any` in public types; row generic `<Row extends GridRow>`.
- Build: tsup ESM+CJS, `sideEffects: false`, subpath exports per package.
- Tests: Vitest + Testing Library; Playwright (apps/storybook) for keyboard/paste/fill flows; SQL snapshot tests in `server`; permission matrix tests in `core` and `server`.
- Lint/format: Biome, double quotes.
- Versioning: Changesets, private npm scope `@masai`.
- CI: bun install, typecheck, test, build; matrix on latest AG Grid 36.x minor.
- Never run `bun run check:fix` / `bun run format` automatically.
- No auto-commits by the orchestrator; implementer subagents commit their own task work on their package branch.

## 8. Acceptance scenario (must pass end to end in demo-api + storybook)
"payment status (select) is not Paid AND call status (date) is within yesterday" in Asia/Kolkata: builder produces AST → server translates → rows with empty payment status ARE included → saved as a view → reopened next day still means "yesterday".
