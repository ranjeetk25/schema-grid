# @ranjeetk25/schema-grid-ui-mantine

Mantine v8 UI for Schema Grid: cell editors and renderers, a filter builder,
a column builder, saved-view and group-by controls, a conflict prompt, an
import wizard, an export dialog, a paste-report toast and a theme bridge.

Peers: `react` 18, `@mantine/core|hooks|dates` ^8, `dayjs`, `zod` `^3.25 || ^4`.
Optional peer: `@mantine/notifications` ^8.

## Entry points

| Import | Contents |
|---|---|
| `@ranjeetk25/schema-grid-ui-mantine` | everything below, plus `ViewSwitcher`, `GroupByBar`, `ConflictPopover`, `RemoteChangedBadge`, `useGridThemeFromMantine`, `notifyClipboardReport` |
| `…/editors` | editors, renderers, `createMantineUiRegistry()` |
| `…/filter-builder` | `FilterBuilder`, `FilterChips`, `FilterButton`, draft model |
| `…/column-builder` | `ColumnBuilderModal`, `ZodForm`, `FormulaEditor`, column draft model |
| `…/import-export` | `ImportWizard`, `ExportDialog` |

```tsx
import { createMantineUiRegistry } from "@ranjeetk25/schema-grid-ui-mantine/editors";

// The real @ranjeetk25/schema-grid-ag-grid registry: createDefaultUiRegistry().extend(...)
const uiRegistry = createMantineUiRegistry({
  widgets: { select: { renderer: MyBadge } }, // ui-mantine widget props, adapted for you
  overrides: { url: { editorPopup: false } }, // raw AG Grid UiFieldType partials
});
```

Widgets are written against small grid-agnostic props (`UiEditorProps`,
`UiRendererProps`) and adapted to AG Grid (`toGridRenderer`,
`toInlineGridEditor`, `toPopupGridEditor` via ag-grid's `createPopupEditor`).
The same widgets power the column builder's default-value field, its preview
and the filter builder's value inputs (`resolveEditorComponent`,
`resolveRendererWidget`, `filterInputFor`).

Column filters are ag-grid's defaults (`ConditionFilter`, whose model is a
core `FilterCondition`); ui-mantine only overrides renderers and editors.

Conflicts: `const prompt = useMantineConflictPrompt()`, pass
`events={{ onConflict: prompt.onConflict }}` to the grid, and render
`<ConflictPopover conflict={prompt.conflict} opened={prompt.opened}
onResolve={prompt.resolve} onClose={prompt.dismiss} …>` when
`prompt.conflict` is set.

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

`notifyClipboardReport(report)` lazily loads `@mantine/notifications` (a literal
`import()`, so bundlers resolve it; pass `{ loader }` to supply the module yourself) and
shows a toast such as "Pasted 40 cells, 3 skipped (2 invalid, 1 read-only)".
Mount `<Notifications />` from `@mantine/notifications` in your app for it to
appear. When the package is not installed it resolves `"unavailable"` and
never throws.

## Upstream contracts

`@ranjeetk25/schema-grid-core`, `-ag-grid` and `-io` are consumed only through
`src/internal/{core,grid,io}-contracts.ts`. All three are real re-exports
plus a few local helpers for gaps (and, for ag-grid, the widget adapters).
