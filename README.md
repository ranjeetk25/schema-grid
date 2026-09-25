# schema-grid

A schema-driven, Airtable-style data grid built as a thin layer on top of AG Grid Community, split into `@masai/schema-grid-core` (schema/field-types/filters/formulas, zero UI deps), `@masai/schema-grid-server` (Drizzle/MySQL query translation and permission enforcement), `@masai/schema-grid-ag-grid` (ColDef compiler, editors, range selection, clipboard, fill handle), `@masai/schema-grid-ui-mantine` (column/filter builders and Mantine widgets), and `@masai/schema-grid-io` (CSV/XLSX import/export). See `docs/superpowers/specs/` for the full design spec.

## Commands

```bash
bun install
bun run typecheck
bun run test
bun run build
bun run lint
bun run changeset
```
