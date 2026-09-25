# @masai/schema-grid-ui-mantine

Mantine v8 UI for Schema Grid: cell editors and renderers, a filter builder,
a column builder, saved-view and group-by controls, a conflict prompt, an
import wizard, an export dialog, a paste-report toast and a theme bridge.

Peers: `react` 18, `@mantine/core|hooks|dates` ^8, `dayjs`, `zod` `^3.25 || ^4`.
Optional peer: `@mantine/notifications` ^8.

## Entry points

| Import | Contents |
|---|---|
| `@masai/schema-grid-ui-mantine` | everything below, plus `ViewSwitcher`, `GroupByBar`, `ConflictPopover`, `RemoteChangedBadge`, `useGridThemeFromMantine`, `notifyClipboardReport` |
| `…/editors` | editors, renderers, `createMantineUiRegistry()` |
| `…/filter-builder` | `FilterBuilder`, `FilterChips`, `FilterButton`, draft model |
| `…/column-builder` | `ColumnBuilderModal`, `ZodForm`, `FormulaEditor`, column draft model |
| `…/import-export` | `ImportWizard`, `ExportDialog` |

```tsx
import { createMantineUiRegistry } from "@masai/schema-grid-ui-mantine/editors";

const uiRegistry = createMantineUiRegistry({
  overrides: { select: { renderer: MyBadge } },
});
```

Hidden columns (access `"hidden"`, or missing from the access map) never
appear in any picker. Formula columns are read-only: no editor, never an
import target.

## Why popup editors skip the portal

Mantine renders dropdowns into `document.body` by default. Inside AG Grid that
breaks editing: a click on a portaled option lands outside the grid, AG Grid
treats it as focus leaving the cell (`stopEditingWhenCellsLoseFocus` plus its
outside-click detection), stops the edit and unmounts the editor before the
option's click registers. The value is lost or the wrong one is committed.

So every dropdown in this package renders inline (`withinPortal: false` on
Combobox/Popover/Menu/Tooltip, `comboboxProps={{ withinPortal: false }}` on
Select/MultiSelect/TagsInput, `popoverProps` on the date pickers, including
`timePickerProps.popoverProps` on `DateTimePicker`). Editors with a dropdown,
picker or multi-line body are wrapped with `createPopupEditor`, which tells
AG Grid to render them in its popup layer (`cellEditorPopup: true`), so the
inline dropdown is not clipped by the cell's `overflow: hidden`.

The same rule keeps `FilterButton`'s popover open while you pick options in
the nested selects.

Popup set: `longText`, `date`, `datetime`, `select`, `multiSelect`,
`creatableSelect`, `user`, `link`.

## Notifications (optional)

`notifyClipboardReport(report)` lazily loads `@mantine/notifications` and
shows a toast such as "Pasted 40 cells, 3 skipped (2 invalid, 1 read-only)".
Mount `<Notifications />` from `@mantine/notifications` in your app for it to
appear. When the package is not installed it resolves `"unavailable"` and
never throws.

## Upstream contracts

`@masai/schema-grid-core`, `-ag-grid` and `-io` are consumed only through
`src/internal/{core,grid,io}-contracts.ts`. Core and io are real re-exports
(plus a few local helpers for gaps); the ag-grid adapter still holds local
fallbacks marked `TODO(ag-grid)` until that package lands.
