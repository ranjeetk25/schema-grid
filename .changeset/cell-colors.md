---
"@ranjeetk25/schema-grid-core": minor
"@ranjeetk25/schema-grid-io": minor
"@ranjeetk25/schema-grid-server": minor
"@ranjeetk25/schema-grid-ag-grid": minor
"@ranjeetk25/schema-grid-ui-mantine": minor
"@ranjeetk25/schema-grid-ui-shadcn": minor
---

v0.4.0: cell colors. This adds Excel-style color coding with conditional color rules, shared manual colors and filter by color.

**Core contract**

- A fixed named palette: `CellColor` (`red`, `orange`, `yellow`, `green`, `teal`, `blue`, `purple`, `pink`, `gray`), `CELL_COLORS` and `isCellColor`. Colors are background fills with light and dark theme variants and no hex values.
- Color rules (`ColorRule`: `{ id, color, target: { kind: "cells", columnIds } | { kind: "row" }, when: FilterNode | null, enabled? }`) are saved per view as `ViewDef.colorRules`. Precedence runs from the manual color, to the first matching `cells` rule for the column, to the first matching `row` rule. `resolveCellColor` / `resolveRowColor` compute the shown color. `validateColorRules` checks structure and access, and rejects color conditions inside a rule (`colorInRule`).
- Manual colors live in `GridRow.colors` (keyed by column id) and are written with `DataSource.setCellColors?(batch: CellColorBatch): Promise<CellColorResult>`. Last write wins. They don't bump `version` / `updatedAt`, but they do appear in the change feed. `canColorCell` means the effective access to the cell is `edit`.
- Filter by color: `COLOR_OPERATORS` (`colorIs` with a list of colors, `colorIsNone`) work on every readable column, `filterable: false` included, and match the shown color. `GridQuery.colorRules` carries the active view's rules so sources can evaluate them. `hasColorCondition(filter)` tells whether they matter.
- `DataSourceCapabilities.cellColors?: { read, write, filter }`, all false by default. `inferCapabilities` sets `write` when the source has `setCellColors`.
- Wire: a new optional operation `setCellColors` answers 501 when absent. `colorRules`, `colors` and `cellColors` are in the wire schemas, and malformed `colorRules` answer `FILTER_INVALID`. `createRemoteDataSource` supports `setCellColors`.
- The in-memory data source stores colors, implements `setCellColors`, filters by color and reports `cellColors` as all true.

**Server**

- `createCellColorsTableDDL` / `createCellColorStore` (`grid_cell_colors` table). Both data sources accept `colors`, hydrate `row.colors` (for readable columns only), implement `setCellColors` with the edit permission check, compile `colorIs` / `colorIsNone` to SQL for the shown color, and include color changes in `getChanges`.

**Grid and UI kits**

- Cells and rows render their shown color. `useSchemaGrid` sends the view's `colorRules` with every fetch. New handle methods: `setCellColor`, `colorRules`, `setColorRules` and `canPaint`. Painting is optimistic, can be undone and follows the change feed.
- Both kits add a "Cell color" paint popover, a "Color rules" editor, "color is" / "has no color" operators in the filter builder, and a "Filter by color" header submenu.
