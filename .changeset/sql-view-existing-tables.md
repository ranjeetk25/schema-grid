---
"@ranjeetk25/schema-grid-ag-grid": minor
"@ranjeetk25/schema-grid-core": minor
"@ranjeetk25/schema-grid-io": minor
"@ranjeetk25/schema-grid-server": minor
"@ranjeetk25/schema-grid-ui-mantine": minor
"@ranjeetk25/schema-grid-ui-shadcn": minor
---

Grids over existing tables (server):

- `createSqlViewDataSource` (`/drizzle`) exposes any existing MySQL table or join as a grid: explicit column expressions over a base query, optimistic writes through `write.update/create/delete` hooks (read-only when absent), `capabilities()`, and an `updated_at` change feed (`changeFeed: "updates-only"`).
- Extension columns beside an existing table: `createExtensionCellStore` + `createExtensionCellsTableDDL` (`/ddl`); schema columns without a mapping are stored per `(grid_id, row_id)`, LEFT JOINed for filter/sort/search/grouping and version-checked on write.
- Schema store: `SchemaStore` (core), `createDrizzleSchemaStore` + `createGridSchemasTableDDL`.
- The SQL translators now resolve columns through a public `ColumnExprResolver` seam (`createJsonCellsResolver`, `createMappedColumnResolver`, `SqlScope.columnExprs`) and select FROM a `RowSource` (`SqlScope.rowSource`); SQL for the JSON-cells grid is unchanged.
- `drizzle-orm` peer range widened to `>=0.41.0 <1` (tested against 0.41 and 0.45).
