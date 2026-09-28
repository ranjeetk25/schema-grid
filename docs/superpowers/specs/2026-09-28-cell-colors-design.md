# Cell colors — conditional rules, manual colors, filter by color

Status: approved (2026-09-28). Target release: **0.4.0** (minor, all six packages, fixed group).

Excel-style color coding for the grid:

1. **Color rules** (conditional formatting): "when <filter> then color <cells | row>", saved per view.
2. **Manual colors**: any user who can edit a cell can paint it (single cell or range); shared by everyone.
3. **Filter by color**: "column X color is red", matching the color the user *sees*.

## Locked decisions

| Decision | Choice |
|---|---|
| Manual color visibility | Shared: stored server-side, every user sees it |
| Rule storage | Per view (`ViewDef.colorRules`) |
| Rule target | Cells of chosen columns, or the whole row |
| Colors | Fixed named palette (no hex) with light/dark theme variants |
| Style | Background fill only |
| Precedence | manual color > first matching `cells` rule for that column > first matching `row` rule > none |
| Filter semantics | Filters by the *shown* color (same precedence) |
| Who can paint | Anyone whose effective access to the cell is `edit` (permission edit AND `settable !== false` AND not a formula column) |
| Manual color storage | New `grid_cell_colors` table, one row per grid row, `colors` JSON map, LEFT JOINed (same pattern as the v0.2 extension-cell store) |

## 1. Core contract (`@ranjeetk25/schema-grid-core`)

New module `packages/core/src/colors/` exported from the root index.

```ts
export type CellColor = "red" | "orange" | "yellow" | "green" | "teal" | "blue" | "purple" | "pink" | "gray";
export const CELL_COLORS: readonly CellColor[];          // in that order
export function isCellColor(v: unknown): v is CellColor;

export type ColorRuleTarget = { kind: "cells"; columnIds: string[] } | { kind: "row" };

export interface ColorRule {
  id: string;
  color: CellColor;
  target: ColorRuleTarget;
  /** Same AST as filters; `null` never matches. */
  when: FilterNode | null;
  /** Default true. */
  enabled?: boolean;
}
```

Additions to existing types:

- `ViewDef.colorRules?: ColorRule[]`: ordered; the first match wins within its tier.
- `GridRow.colors?: Record<string /* columnId */, CellColor>`: **manual** colors only. Absent or `{}` means none. Rule colors are never stored on rows.
- `GridQuery.colorRules?: ColorRule[]`: the active view's rules, sent by the client with every `fetch` (and export iteration) so that the server can evaluate `colorIs` filters. The server ignores rules unless a `colorIs`/`colorIsNone` condition is present.

Resolution (pure, client and memory source):

```ts
export interface ColorMatchContext extends FilterMatchContext {}
/** Shown color of one cell, or null. Precedence: manual > cells-rule > row-rule. */
export function resolveCellColor(row: GridRow, columnId: string, rules: readonly ColorRule[] | undefined, ctx: FilterMatchContext): CellColor | null;
/** First matching enabled `row` rule's color, or null (used for row background). */
export function resolveRowColor(row: GridRow, rules: readonly ColorRule[] | undefined, ctx: FilterMatchContext): CellColor | null;
/** Structural + access validation (unknown color, empty columnIds, unknown/unreadable column in target or `when`, invalid `when` via validateFilter). */
export function validateColorRules(rules: unknown, schema: GridSchema, access: ...same access input validateFilter takes...): { ok: true; rules: ColorRule[] } | { ok: false; issues: FilterIssue[] };
```

Filter operators (new, available on **every readable column**, including `filterable: false` columns, because they filter the annotation, not the value):

- `colorIs`: `value: CellColor[]` (valueKind `"multi"`): the shown color is one of these.
- `colorIsNone`: `valueKind "none"`: no shown color.

Export them as `COLOR_OPERATORS`. `validateFilter` accepts them on any readable column and validates the values with `isCellColor`. `matchesFilter` evaluates them using `resolveCellColor`, so `FilterMatchContext` gains `colorRules?: readonly ColorRule[]`. A `colorIs` condition inside a rule's own `when` is rejected (`code: "colorInRule"`) to avoid recursion.

Writes (manual colors):

```ts
export interface CellColorChange { rowId: string; columnId: string; color: CellColor | null /* null = clear */ }
export interface CellColorBatch { id: string; changes: CellColorChange[] }
export interface CellColorResult {
  applied: CellColorChange[];
  rejected: { rowId: string; columnId: string; message: string }[];
  /** Rows as they now are (optional; the client patches `colors` from `applied` otherwise). */
  rows?: GridRow[];
}
DataSource.setCellColors?(batch: CellColorBatch): Promise<CellColorResult>;
```

- Manual colors are **last-write-wins**. They do **not** bump `GridRow.version` or `updatedAt`, so they never conflict with data edits.
- Wire: new optional op `setCellColors` (`input: CellColorBatch`, `output: CellColorResult`), added to `GRID_OPERATIONS` and `OPTIONAL_GRID_OPERATIONS` (answers 501 when absent), with a zod schema in `wire/schemas.ts` and `createRemoteDataSource` support.
- Capabilities: `DataSourceCapabilities.cellColors?: { read: boolean; write: boolean; filter: boolean }`. `normalizeCapabilities` defaults it to all-false; `inferCapabilities` sets `write` true when the source has `setCellColors`. When `read` is false the grid still renders rule colors (client-side) but manual colors and the paint UI are hidden. When `filter` is false the `colorIs` operators are hidden.
- Change feed: `ChangeFeedEntry` rows carry `colors`. A color change must make the row appear in the next `getChanges` (see §2).
- Memory data source (`core/memory`): stores colors, implements `setCellColors` with the same access check, evaluates `colorIs`/`colorIsNone` via `resolveCellColor` with `query.colorRules`, and emits colored rows in its feed. Capabilities: `cellColors` all true.
- Access helper: `canColorCell(row, column, user, resolver)` means effective access is `edit` (reuse the existing `canEditCell`/`resolveColumnAccess` logic; no new permission).

## 2. Server (`@ranjeetk25/schema-grid-server`)

Storage: `createCellColorsTableDDL({ table })` and `createCellColorStore({ db, table })` in `./drizzle`. The table has `grid_id VARCHAR`, `row_id VARCHAR`, `colors JSON NOT NULL`, `updated_at DATETIME(3)`, `updated_by VARCHAR NULL`, and `PRIMARY KEY (grid_id,row_id)`. Mirror `extension-store.ts` (DDL helper, `available()` probe, safe table name).

Both data sources (`createDrizzleDataSource`, `createSqlViewDataSource`) accept `colors?: CellColorStore`:

- **Read**: LEFT JOIN the store on `(grid_id,row_id)` and hydrate `row.colors`, **dropping columns the caller cannot read**.
- **Write**: `setCellColors` checks `canColorCell` per change using the same row load / permission path as `applyChanges`. Rejected cells go to `rejected` with message `"Read-only"`. Applied changes are upserted with `JSON_SET` / `JSON_REMOVE` in one transaction per batch, and `updated_at`/`updated_by` are set. Unknown row → rejected `"Row not found"`.
- **Filter**: a `colorIs` condition on column `c` compiles to SQL for the *shown* color:
  `COALESCE(manual(c), CASE WHEN r1.when THEN r1.color … END /* cells rules targeting c, in order */, CASE … END /* row rules */) IN (…)`
  Here `manual(c) = JSON_UNQUOTE(JSON_EXTRACT(colors, '$."c"'))`. Each rule's `when` compiles with the existing `translateFilter` (reuse, no duplicated SQL). `colorIsNone` is the `IS NULL` form. Rules come from `query.colorRules`, validated with `validateColorRules` (400 `INVALID_FILTER` on failure; unreadable columns referenced by rules are rejected, as for filters). Without a store, `manual(c)` is `NULL` (rules-only filtering still works).
- **Feed**: `getChanges` also returns rows whose `grid_cell_colors.updated_at` is newer than the cursor (merged with data changes, deduped by row id). The cursor format is unchanged.
- **Capabilities**: `cellColors = { read: !!store, write: !!store && writable, filter: true }`. Writable follows the existing `write.cells` logic.
- Row deletion also deletes that row's color entry.
- Group-by / sort by color: out of scope.
- `defineGrid` / HTTP adapters route the new op with no extra wiring beyond the op list.
- demo-api: wire a color store into the leads grid and the admissions grid, and add the table to bootstrap DDL. The `apps/demo-api/src/leads/grid.ts` 40-line / `docs/consuming.md` byte-identity constraint still holds (update both).
- Tests: unit tests for the SQL builder, plus the MySQL integration suite (`test:integration`) covering hydrate, permissions, `colorIs` with manual + cells-rule + row-rule precedence, `colorIsNone`, feed, and delete cleanup, on both data sources.

## 3. Grid (`@ranjeetk25/schema-grid-ag-grid`)

- **Render**: every cell gets a background from `resolveCellColor(row, colId, view.colorRules, ctx)`. Row rules color the whole row (the cell tier overrides on top). Implement via `cellClassRules` / a class per color (`sg-color-<name>`) from `theme/classNames.ts`, with light and dark tokens in `theme/theme.ts`. Range selection and focus outlines must remain visible over a color. Resolution is memoized per row version + colors + rules identity.
- **Query**: `useSchemaGrid` puts the current view's `colorRules` into `GridQuery.colorRules` for fetch and export iteration. A rules change refetches only when the active filter contains a color operator; otherwise it just redraws.
- **Paint**: new handle methods:
  ```ts
  SchemaGridHandle.setCellColor(color: CellColor | null, target?: "selection" | { rowId: string; columnId: string }[]): Promise<CellColorResult | null>;
  SchemaGridHandle.colorRules: ColorRule[];                 // current view's
  SchemaGridHandle.setColorRules(rules: ColorRule[]): void; // updates view → onViewChange
  SchemaGridHandle.canPaint(): boolean;                     // capabilities.cellColors.write && any selected cell paintable
  ```
  The default target is the current range selection (or the focused cell). Cells failing `canColorCell` are skipped client-side and counted. Updates are optimistic with rollback on `rejected` or an error. Each paint is **one undo entry** (undo restores the previous manual colors via another `setCellColors`). The polling feed applies incoming `colors`.
- **Views**: `captureViewState` / apply carry `colorRules`. Schema column deletion drops dangling rule targets (a rule with no remaining target is removed).
- **Filters**: the column filter (`filters/`) offers "Color is…" when `capabilities.cellColors.filter` is true.
- **Copy/paste/fill**: colors are NOT copied (values only). Out of scope.
- Export: CSV/XLSX ignore colors (out of scope).
- Tests: vitest for resolution memo, query wiring, paint/undo/rollback, feed merge, and view capture.

## 4. UI kits (`ui-mantine` and `ui-shadcn`, same features in both)

- **Paint UI**: a "Cell color" swatch popover (palette + "No color") in the workbench toolbar and in the cell context menu if one exists (otherwise toolbar only), enabled when `handle.canPaint()`. It shows a report when some cells were skipped (reuse the notifications pattern).
- **Rules editor**: a "Color rules" toolbar button opens a dialog listing the view's rules. Each rule has a color swatch, a target (whole row / multi-select columns), a condition built with the existing filter builder component, enable toggle, reorder (up/down), and delete. Saving calls `handle.setColorRules`, which flows to the view like filter/sort.
- **Filter builder**: the column's operator list includes "color is" / "has no color" with a swatch multi-select value editor when the capability allows.
- **Header menu**: "Filter by color" submenu listing palette swatches (sets a `colorIs` condition on that column).
- A shared palette display (label + swatch per `CellColor`) lives in each kit's theme module, using the same tokens as the grid.
- Storybook: a `CellColors` story in both storybooks (rules, manual paint, filter by color), plus Playwright e2e for paint → filter → undo.

## Out of scope

Hex/custom colors, text color, bold, sorting or grouping by color, copying colors with clipboard/fill, colors in exports, per-user (personal) colors, grid-wide rules outside views.

## Implementation order

1. core (contract + memory source), which the other packages depend on
2. server ∥ ag-grid
3. ui-mantine ∥ ui-shadcn (+ storybook stories, demo-api wiring)
4. changeset (`minor`, all six), docs (`docs/consuming.md`, `docs/wire-contract.md`, `docs/upgrading.md`)
