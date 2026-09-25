---
"@ranjeetk25/schema-grid-core": minor
"@ranjeetk25/schema-grid-server": minor
"@ranjeetk25/schema-grid-ag-grid": minor
"@ranjeetk25/schema-grid-io": minor
"@ranjeetk25/schema-grid-ui-mantine": minor
"@ranjeetk25/schema-grid-ui-shadcn": minor
---

Many grids behind one endpoint (spec C5).

- core `./wire`: grid-level operations `getSchema` / `updateSchema` (`GRID_SCHEMA_OPERATIONS`, `isGridSchemaOperation`,
  `gridSchemaSchema`) and the wire codes `UNKNOWN_GRID` (404), `METHOD_NOT_ALLOWED` (405) and `SCHEMA_CONFLICT` (409).
  `GRID_OPERATIONS` is now documented as a set that later versions extend.
- server `./http`: `defineGrid`, `createGridRegistry` (`handle(gridId, op, input, ctx)`, `list(ctx)`),
  `createMemorySchemaStore`, `toFetchHandler` (Web `Request → Response`), `toExpressRouter`, a registry overload of
  `toLambdaHandler`, and `toWireFailure`.
- ag-grid: `createGridClient({ baseUrl, gridId })` → `{ dataSource, getSchema, updateSchema, capabilities }`.
