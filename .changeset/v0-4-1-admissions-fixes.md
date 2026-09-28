---
"@ranjeetk25/schema-grid-core": patch
"@ranjeetk25/schema-grid-io": patch
"@ranjeetk25/schema-grid-server": patch
"@ranjeetk25/schema-grid-ag-grid": patch
"@ranjeetk25/schema-grid-ui-mantine": patch
"@ranjeetk25/schema-grid-ui-shadcn": patch
---

0.4.1: fixes from the admissions integration of 0.4.0.

- **Missing color table no longer breaks the grid.** Both data sources check `CellColorStore.available()` (cached; `store.reset()` drops it). While the `grid_cell_colors` table is missing they behave as if no store were passed: no colors on rows, `cellColors.read/write: false`, and `setCellColors` answers 501. With `colors`, `createSqlViewDataSource`'s `capabilities()` is now async; `await` it if you read it directly.
- **Color rules on computed / unfilterable columns.** Rules may test `filterable: false` and computed columns; they render as before. Filtering a column by color when such a rule affects it now answers a clear 400 (`Can't filter "Verdict" by color: a color rule on it uses "Verdict", which can't be filtered on the server`) instead of `Column "Verdict" cannot be filtered`. Both kits and the grid's column filters hide or disable color filtering on those columns and show the reason, and the rules dialog marks such rules "Can't be used to filter by color". New core helpers: `colorFilterBlockers`, `sqlFilterablePredicate`, `colorRuleUnfilterableColumn`, `colorFilterBlockedMessage`; ag-grid `colorFilterBlockedReason`.
- **Clear refusal for per-person rules.** An edit or paint denied by `permissions.edit` now says "Only specific people can edit this column" (never listing ids), on the server and in the client pre-check. Formulas and `settable: false` keep their read-only messages. New core `cellEditDenial` and message constants. `createRows` answers a hidden column as "Unknown column".
- **Dev warning.** `defineGrid` warns once per grid (outside production) when permission redaction runs without a `{ id, roles }` user.
- **Capability-gated field types.** Link needs `lookup`, User needs `options` (core `fieldTypeAvailability`, `FieldType.requires`). The column builder hides types the grid can't back (existing columns keep theirs, with the reason); the link / user pickers, Creatable select "+ Create", dynamic selects, set filters and the filter builder's people search check capabilities instead of calling a method the server will refuse. `updateSchema` rejects adding or retyping a column the source can't back (400, `"X" can't be a link column: this grid has no records to link to`). `capabilities.options` is now reported truthfully by both data sources.
