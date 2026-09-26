# @ranjeetk25/schema-grid-ui-mantine

Mantine v8 UI for Schema Grid: cell editors and renderers, a filter builder,
a column builder, saved-view and group-by controls, a conflict prompt, an
import wizard, an export dialog, a paste-report toast and a theme bridge.

Peers: `react` 18, `@mantine/core|hooks|dates` ^8, `dayjs`, `zod` `^3.25 || ^4`.
Optional peer: `@mantine/notifications` ^8.

## One-component page

`<SchemaGridWorkbench>` is a whole admin grid page: header, saved views,
filter + chips, group, search, undo/redo, import, export, "Add column" (side
panel with a ghost-column preview), the conflict prompt, polling and a quiet
status bar. Features follow the data source's capabilities (`groupBy:false`
hides Group, `search:false` hides search, `changeFeed:false` stops polling,
`"updates-only"` polls without removing rows, `write.cells:false` makes the
grid read-only with a banner, `export.maxRows` caps the CSV export); the
toolbar waits for them to load. `features` can only switch things off.

```tsx
import { createGridClient } from "@ranjeetk25/schema-grid-ag-grid";
import { SchemaGridWorkbench } from "@ranjeetk25/schema-grid-ui-mantine";

// Module scope: the workbench compares the client by reference.
const leads = createGridClient({ baseUrl: "/api/grid", gridId: "leads" });

export function LeadsPage({ user }: { user: PermissionUser }) {
  return (
    <div style={{ height: "100dvh" }}>
      <SchemaGridWorkbench client={leads} user={user} title="Leads" subtitle="All applicants" />
    </div>
  );
}
```

Without a server client, pass `dataSource` + `schema` (+ `onSchemaChange` to
persist column edits). Other props:

| Prop | |
|---|---|
| `resolver`, `registry`, `uiRegistry`, `mode` | defaults: role resolver, default registries, `"server"` with `client` else `"client"` |
| `views` + `onViewsChange` / `viewStore` | controlled views, or a `WorkbenchViewStore` (`load(gridId)`/`save(gridId, views)`); default `createLocalStorageViewStore()` keyed by grid id |
| `features` | `Partial<{ filter, group, search, views, export, import, addColumn, undo, polling }>` — `false` turns one off |
| `toolbarStart`, `toolbarEnd`, `statusBar` | a node or `(ctx) => node`; `ctx` has `handle`, `schema`, `features`, `capabilities` (raw, once loaded), `effectiveCapabilities` (core `mergeCapabilities`, `null` until loaded), `openImport`, `openExport`, `openAddColumn`, `refetch` |
| `emptyState` | shown over the grid when there are no rows |
| `onError(error)` | every `{ kind, op, message, error }` also shown as a banner: `permission-denied`, `network` (Retry), `capability-denied`, `schema-changed` (Reload), export failures (`op: "export"`, banner with Retry) |
| `events` | host grid events merged with the workbench's own (see below) |
| `exportFileName` | a string, or `(ctx) => string` with `{ gridId, schema, view, format, date }`; default `${gridId}-${view ?? "all"}-${YYYY-MM-DD}.csv`, slugified |
| `pollIntervalMs`, `height` (`"fill"` default: give the parent a height), `pageSize`, `roles`, `gridProps` | |

### Host events

`events?: Partial<SchemaGridEvents>` (also `gridProps.events`; a handler on
`events` wins per name). `beforeCellsChange` chains **host → workbench**: the
host may veto with `false`, or return a transformed / reduced batch — `meta`
on the batch or on individual changes travels to the data source untouched.
Every other event (`onCellsChange`, `onConflict`, `onRowsCreate/Delete`,
`onColumn*`, `onOptionCreate`, `onViewChange`, `onRemoteChanges`,
`onSchemaChanged`) fans out to the host first, then the workbench; a throwing
host handler is reported through `onError` and never breaks the built-in
handling (the conflict prompt still opens after your `onConflict`).

### Columns picker

The toolbar "Columns" button lists every column the user may read (columns
hidden by permission are never listed; `ColumnDef.hidden` ones start
unchecked): search, a checkbox per column, move up / down, "Show all" /
"Hide all", and a badge with the hidden count. Changes go through the grid's
column state, so they live in the current view (marked unsaved), persist with
"Save changes" / "Save as new view" and are undone by switching views.

### Who may change the schema

With a `client`, "Add column", the header's "Edit column… / Insert…" and the
trailing "+" appear only when the server's capabilities report
`schema.write: true` (`createGridRegistry` answers it from `permission(ctx,
"updateSchema")` and the presence of a schema store). In direct
(`dataSource` + `schema`) mode the host owns the schema, so they stay on;
`features.addColumn: false` still turns them off.

### Restricted options

A select / multiSelect / creatableSelect option may carry
`settableBy: { roles: [...] }` (core `Option.settableBy`). The pickers offer
only the options the signed-in user can set; a value the row already holds
stays visible and renders normally, but is locked in the picker with an
"Only Admin can set this" tooltip. Servers and the in-memory source reject
the rest ("Option “Verified” can only be set by Admin"), which the grid shows
as a cell error. The column panel's Options editor has a per-option "Who can
set" pill (Everyone | Only roles…) mirroring the column's access section.

### Saved vs. not saved

The status bar's "N saved" counts applied **cells**. Changes a data source
(or a `beforeCellsChange` hook that dropped them) declines quietly come back
as `ChangeResult.rejected`: the cell reverts with no error state, nothing is
announced assertively, and the bar reads "N changes not saved" (paste
summaries add "R not saved").

### Lazy chunks

The import wizard, the export dialog and the column panel load on first
open, and `@ranjeetk25/schema-grid-io` (exceljs, papaparse) is imported only
inside an export / import run, so none of them sit in the page chunk.

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
