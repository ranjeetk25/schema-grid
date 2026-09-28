# @ranjeetk25/schema-grid-ui-shadcn

A second UI kit for Schema Grid, built on **shadcn/ui** (Radix primitives), **Tailwind CSS v4** and
**lucide-react**. It fulfils the same contracts as `@ranjeetk25/schema-grid-ui-mantine` and has the
same public API, apart from renames where a name said "Mantine" (`createShadcnUiRegistry`,
`useShadcnConflictPrompt`, `useGridThemeFromShadcn`, `ShadcnHeaderMenu`). Pick one of the two kits;
[`docs/design/ui-kits.md`](../../docs/design/ui-kits.md) compares them.

The design follows Linear density, Vercel restraint and Airbnb warmth:
- 13px chrome, 32px controls and 36px rows.
- Zinc neutrals with one indigo accent, 1px hairlines and 6px radii.
- Tabular numerals.
- One primary action per surface.
- Errors appear only after a field is touched.
- Dark mode is designed, not inverted.

## Install

```bash
bun add @ranjeetk25/schema-grid-ui-shadcn @ranjeetk25/schema-grid-ag-grid @ranjeetk25/schema-grid-io \
  @ranjeetk25/schema-grid-core ag-grid-community ag-grid-react zod
# optional: toasts for paste/fill reports
bun add sonner
```

Peers: `react`/`react-dom` ^18, `ag-grid-community`/`ag-grid-react` ^36, `@ranjeetk25/schema-grid-ag-grid`,
`@ranjeetk25/schema-grid-io`, `zod` ^3.25 || ^4, and `sonner` ^2 (optional).

Radix, `cmdk`, `react-day-picker`, `lucide-react`, `class-variance-authority`, `clsx` and `tailwind-merge`
are regular dependencies. You don't install shadcn yourself; the components ship inside this package.

```tsx
import "@ranjeetk25/schema-grid-ui-shadcn/styles.css";
import { SchemaGrid } from "@ranjeetk25/schema-grid-ag-grid";
import { FilterButton, ColumnPanel, ShadcnHeaderMenu, useGridThemeFromShadcn } from "@ranjeetk25/schema-grid-ui-shadcn";
import { createShadcnUiRegistry } from "@ranjeetk25/schema-grid-ui-shadcn/editors";

const uiRegistry = createShadcnUiRegistry({ fieldTypes: registry });

function Grid() {
  const { theme } = useGridThemeFromShadcn();
  return <SchemaGrid uiRegistry={uiRegistry} theme={theme} headerMenu={ShadcnHeaderMenu} /* … */ />;
}
```

Subpaths mirror ui-mantine:
- `.`
- `./editors` (editors, renderers, registry and column filters)
- `./filter-builder`
- `./column-builder`
- `./import-export`
- `./styles.css`
- `./tailwind.css`

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
import "@ranjeetk25/schema-grid-ui-shadcn/styles.css";
import { SchemaGridWorkbench } from "@ranjeetk25/schema-grid-ui-shadcn";

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
| `features` | `Partial<{ filter, group, search, views, export, import, addColumn, undo, polling, paint, colorRules }>` — `false` turns one off |
| `toolbarStart`, `toolbarEnd`, `statusBar` | a node or `(ctx) => node`; `ctx` has `handle`, `schema`, `features`, `capabilities` (raw, once loaded), `effectiveCapabilities` (core `mergeCapabilities`, `null` until loaded), `openImport`, `openExport`, `openAddColumn`, `refetch` |
| `emptyState` | shown over the grid when there are no rows |
| `onError(error)` | every `{ kind, op, message, error }` also shown as a banner: `permission-denied`, `network` (Retry), `capability-denied`, `schema-changed` (Reload), export failures (`op: "export"`, banner with Retry) |
| `events` | host grid events merged with the workbench's own (see below) |
| `exportFileName` | a string, or `(ctx) => string` with `{ gridId, schema, view, format, date }`; default `${gridId}-${view ?? "all"}-${YYYY-MM-DD}.csv`, slugified |
| `pollIntervalMs`, `height` (`"fill"` default: give the parent a height), `pageSize`, `roles`, `gridProps` | |
| `userDirectory` | v0.4 `{ search(query), resolve(ids) }` → `ActorRef[]`: adds People pickers (per-person `RoleRule.users`) to "Who can access" and option "Who can set". Absent: no People pickers; stored `users` are kept |

### Host events

`events?: Partial<SchemaGridEvents>` (also `gridProps.events`; a handler on
`events` wins per name). `beforeCellsChange` chains **host → workbench**: the
host may veto with `false`, or return a transformed / reduced batch — `meta`
on the batch or on individual changes travels to the data source untouched.
Every other event (`onCellsChange`, `onConflict`, `onRowsCreate/Delete`,
`onColumn*`, `onOptionCreate`, `onViewChange`, `onRemoteChanges`,
`onSchemaChanged`) fans out to the host first, then the workbench; a throwing
host handler is reported through `onError` and never breaks the built-in
handling (the conflict popover still opens after your `onConflict`).

### Columns picker

The toolbar "Columns" button (a Radix popover) lists every column the user may
read (columns hidden by permission are never listed; `ColumnDef.hidden` ones
start unchecked): search, a checkbox per column, move up / down, "Show all" /
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
`settableBy: { roles: [...] }` (core `Option.settableBy`). The cmdk pickers
offer only the options the signed-in user can set; a value the row already
holds stays visible and renders normally, but is locked in the picker
(disabled, with an "Only Admin can set this" title). Servers and the
in-memory source reject the rest ("Option “Verified” can only be set by
Admin"), which the grid shows as a cell error. The column panel's Options
editor has a per-option "Who can set" pill (Everyone | Only roles…, role
chips) mirroring the column's access section.

### Saved vs. not saved

The status bar's "N saved" counts applied **cells**. Changes a data source
(or a `beforeCellsChange` hook that dropped them) declines quietly come back
as `ChangeResult.rejected`: the cell reverts with no error state, nothing is
announced assertively, and the bar reads "N changes not saved" (paste
summaries add "R not saved").

### Cell colors (v0.4)

The workbench exposes the grid's cell colors (see the ag-grid README, "Cell colors") without extra wiring:

- **Paint:** a "Cell color" toolbar button (paint bucket) opens the palette (9 swatches + "No color") and paints
  the range selection, or the focused cell, through `handle.setCellColor`. It shows only when the source reads
  and writes colors (`features.paint`: `capabilities.cellColors.read` + `write`), and is unavailable until `handle.canPaint()`
  (some selected cell is editable). Each paint is one undo step. Skipped read-only cells and rejected ones go to
  the status bar ("Colored 2 cells, 1 skipped (1 read-only)") and a `sonner` toast; your
  `gridProps.onCellColorReport` still runs. The grid has no cell context menu, so painting is toolbar-only.
- **Color rules:** a "Color rules" button (`features.colorRules`, with the rule count) opens a dialog listing the current view's rules.
  Each rule has a color, a target (whole row, or chosen columns), a condition built with the `FilterBuilder`
  (color operators excluded), an on / off switch, move up / down and delete. "Save rules" validates with
  core's `validateColorRules` (issues show on the rule) and calls `handle.setColorRules`, so the view is marked
  unsaved like a filter change. Rules render client-side, so they work without the `cellColors` capability.
- **Filter by color:** with `cellColors.filter`, the Filter builder offers "color is" (a swatch multi-picker) and
  "has no color" on every readable column, `filterable: false` ones included, and each column's header menu gets
  a "Filter by color" submenu (palette, "No color", "Clear color filter"; the active color is checked) that sets
  one color condition on that column. ag-grid's header-menu actions can't set a filter, so the workbench puts a
  `CellColorFilterProvider` around the grid and `ShadcnHeaderMenu` reads it (`useCellColorFilter`).
- **Rules the server can't evaluate (v0.4.1):** a rule's condition may test a `filterable: false` column (a
  SQL-view computed column, say): the rule still renders, and the dialog notes it with "Can't be used to filter
  by color". A column such a rule can color (its `cells` targets; every column for a `row` rule) can't be
  filtered by color on the server, so the Filter builder leaves out "color is" / "has no color" for it (the
  operator list says why) and its header menu shows "Filter by color" disabled with the reason
  (`Can't filter by color: a color rule on it uses "Verdict", which can't be filtered on the server`); an active
  color filter there can still be cleared. The check is ag-grid's `colorFilterBlockedReason`, against the
  effective schema and capabilities.

The pieces are exported for hosts that build their own page:

| Export | |
|---|---|
| `CellColorButton` (`handle`, `onError`), `useCanPaint(handle)` | the paint popover and its live enabled state |
| `CellColorPicker` (`value`, `onPick`, `allowNone`) | the swatch grid |
| `ColorSwatchMultiSelect` (`value`, `onChange`) | the palette multi-select (the `colorIs` value editor) |
| `ColorRulesDialog` (`opened`, `onClose`, `schema`, `registry`, `uiRegistry`, `access`, `rules`, `onSave`, `dataSource`, `capabilities`) | the rules editor; `addColorRule`, `moveColorRule`, `updateColorRule`, `removeColorRule`, `validateColorRulesDraft`, `ruleIssueMessages` are its pure model. v0.4.1: `capabilities` (`handle.effectiveCapabilities`) adds the source's filter scope to the "Can't be used to filter by color" check |
| `FilterBuilder` / `FilterButton` `capabilities` prop | pass `handle.effectiveCapabilities` to get the color operators (and, v0.4.1, the `lookup` / `options` gates for the value pickers) |
| `FilterBuilder` / `FilterButton` `colorRules` prop (v0.4.1) | the view's rules (`handle.colorRules`): no color operators on a column one of them blocks (the operator list says why; `FilterDraftApi.colorBlockedReasonFor(columnId)`). Pure model: `colorBlockedReason(column, capabilities, { rules, schema })`, and `filterableColumns` / `operatorsFor` take a last `ColumnPickOptions` (`{ allowUnfilterable?, colorRules? }`); `operatorsInContext(column, ctx)` |
| `FilterBuilder` / `FilterButton` `allowUnfilterable` prop (v0.4.1) | offer and accept `filterable: false` columns with their own operators (client-side conditions, like rule conditions); leave it off for grid filters |
| `CellColorFilterProvider` (`value: { activeColors(columnId), filterByColor(columnId, next), blockedReason?(columnId) } \| null`), `useCellColorFilter()` | wrap `<SchemaGrid headerMenu={ShadcnHeaderMenu}>` to get the header submenu; `blockedReason` (v0.4.1, e.g. ag-grid's `colorFilterBlockedReason`) disables it on a blocked column |
| `setColumnColorFilter(filter, columnId, next)`, `columnColorFilter(filter, columnId)` | write / read one column's color condition: `CellColor[]` (`colorIs`), `"none"` (`colorIsNone`), `null` (none / clear) |
| `formatCellColorReport`, `notifyCellColorReport`, `cellColorSummary` | paint report text and toast |
| `CELL_COLOR_PALETTE`, `CellColorSwatch`, `cellColorLabel` | the palette (label, light / dark fill, swatch per `CellColor`) |

Dark mode: `styles.css` declares the grid's `--sg-color-*` fills for `:root` and `.dark` (ag-grid's
`cellColorCssVariables("light" | "dark")`), and `useGridThemeFromShadcn()` returns the current scheme's map as
`cellColorVariables` for containers styled without the stylesheet.

### Capability-gated field types (v0.4.1)

A link column needs a source that can `lookup` records, a user column one that serves `options` (people search);
custom field types declare theirs in `FieldType.requires` (core `fieldTypeAvailability`).

- The column builder (`ColumnPanel`, `ColumnBuilderDialog`, `TypePicker`, `TypeStep`) takes `capabilities` (the
  workbench passes `effectiveCapabilities`) and hides the types the grid can't back. An existing column keeps its
  type, shown with the reason ("Linking isn't set up for this grid").
- Pickers check capabilities, not whether the data source has the method: without `lookup` the link picker (cell
  editor and the column builder's default value) shows the current links and "Linking isn't set up for this
  grid" instead of calling `lookup`; without `options` the user picker says "People search isn't set up for this
  grid", creatable selects offer no "Create" entry ("Creating options isn't set up for this grid"), and dynamic
  selects, the set filter and the filter builder's people list keep their static options instead of calling
  `getOptions`. In a grid cell the capabilities come from the grid context; widgets receive them as
  `UiEditorProps.capabilities` (`UiFilterInputProps.capabilities` for filter inputs).
- A per-person edit refusal ("Only specific people can edit this column") reaches the cell error and the save
  banner unchanged.

### Lazy chunks

The import wizard, the export dialog, the column panel and the color rules dialog load on first
open, and `@ranjeetk25/schema-grid-io` (exceljs, papaparse) is imported only
inside an export / import run, so none of them sit in the page chunk.

## CSS strategy

Every Tailwind utility in this package is written with the **`sg:` prefix** (Tailwind v4 `prefix(sg)`), and
every theme variable it generates is `--sg-*`. **Preflight is not included.** A small reset scoped to `.sg-ui`
replaces it, and it applies to every root this package renders, including Radix portal content. The result
can't collide with a host's own Tailwind build and doesn't restyle the host page.

Choose one of two ways to load it:

1. **Prebuilt (most hosts).** `import "@ranjeetk25/schema-grid-ui-shadcn/styles.css"` loads a minified file of
   about 47 kB (about 9 kB gzipped) containing only the classes the kit uses, plus the tokens. No Tailwind is
   needed in the host.
2. **Tailwind v4 source (hosts that run Tailwind v4 and want to re-theme through `@theme`).** Import
   `@ranjeetk25/schema-grid-ui-shadcn/tailwind.css` as its **own CSS entry**, a separate Tailwind root from
   your app's `@import "tailwindcss"`, because Tailwind allows one prefix per root. Its `@source "./"` scans the
   package's `dist`. Add `@source "../your/src"` to the same file if your own markup uses `sg:` classes; the
   shadcn Storybook does this.

The CSS uses cascade layers (`theme, base, components, utilities`). Unlayered host rules win over layered ones,
so keep global element selectors such as `button { padding: … }` out of the grid's subtree, or put them in a
layer.

Dark mode: add the `dark` class to `<html>` (the shadcn convention). A `.sg-ui.dark` element also works for a
scoped subtree, but portalled menus resolve tokens from `<html>`.

## Theming tokens

`src/styles/tokens.css` defines the kit tokens, in light and dark versions:

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `--sg-ui-background` | `#ffffff` | `#18181b` | surfaces (grid, cards, dialogs) |
| `--sg-ui-subtle` | `#fafafa` | `#1f1f23` | header band, footers, hover fill |
| `--sg-ui-muted` | `#f4f4f5` | `#27272a` | pills, segmented tracks |
| `--sg-ui-foreground` | `#09090b` | `#e4e4e7` | text |
| `--sg-ui-muted-foreground` | `#71717a` | `#a1a1aa` | labels, helper text |
| `--sg-ui-border` / `--sg-ui-input` | `#e4e4e7` | `#2e2e33` / `#34343a` | hairlines / control borders |
| `--sg-ui-primary` | `#5e6ad2` | `#7c86dc` | the ONE accent: primary button, focus ring, selection, active filter |
| `--sg-ui-danger` | `#dc2626` | `#f87171` | destructive / errors |
| `--sg-ui-shadow-popover` / `-dialog` | soft | stronger | floating layers only |
| `--sg-ui-font` / `--sg-ui-font-mono` | Geist → system stack | | |
| `--sg-tone-{gray,red,orange,yellow,lime,green,teal,cyan,blue,indigo,violet,grape,pink}-{bg,fg,dot}` | muted tonal pairs | retuned | select option badges and avatars |

To re-theme, override the tokens **unlayered** in your own CSS, e.g. `:root { --sg-ui-primary: #0f766e; }`.
The same file also sets the cross-package **grid contract** (`--sg-accent-color`, `--sg-background-color`,
`--sg-border-color`, and so on; see `docs/design/README.md`) from the kit tokens. The AG Grid theme therefore
follows the kit and `.dark` live. `useGridThemeFromShadcn()` returns a memoised `createSchemaGridTheme()`
plus `scheme` (tracked through a MutationObserver on `html.dark`) and the resolved `params`.

Option colours in a schema, such as `{ color: "green" }`, are the same names ui-mantine uses, so one schema
renders correctly in both kits. Raw CSS colours are tinted with `color-mix`.

## Parity with ui-mantine

| Area | ui-mantine | ui-shadcn |
| --- | --- | --- |
| Editors (16 types) | Mantine inputs, popup editors | Opaque popup cards at least `max(240px, cell width)` wide; cmdk lists and the calendar render inline in the card; validation shows inside the card; `Create “x”` option in creatable selects |
| Boolean | in-place (ag-grid) | in-place (ag-grid's `.sg-bool` renderer); `BooleanEditor` is kept for forms and filters |
| Renderers | Badge/Pill/Avatar | Tonal badges, multi-select pills clamped to one row with "+N" based on available width, avatar + name, `ƒ` formula prefix with "Formula · {expr}" tooltip |
| Column filters | ag-grid's framework-free defaults | Radix `ShadcnConditionFilter` / `ShadcnSetFilter` for every type |
| Header menu | ag-grid's `DefaultHeaderMenu` | `ShadcnHeaderMenu` (Radix dropdown) |
| Filter builder | Popover + Apply | Inline rows in the style of Notion/Linear; live 300ms debounced apply, switching to an explicit Apply footer above `liveFilterThreshold` (5k server / 10k client); unapplied-changes dot on chips; inline `error` (pure `filterApplyModel`) |
| Grouping | `GroupByBar` selects | One "Group" button → popover with removable rows, an add combobox and collapsed "Summaries" |
| Column builder | `ColumnBuilderModal` stepper | `ColumnPanel`: a non-modal 420px right-side panel with a single form, live ghost column through `SchemaGrid.draftColumn`, and a plain-English "Who can access" section. `ColumnBuilderDialog` (with a `ColumnBuilderModal` alias) is the modal version |
| Views | ViewSwitcher | ViewSwitcher (`menuitemradio` rows) |
| Conflicts | ConflictPopover + prompt hook | Same API, plus `yourValue` and `anchor` props |
| Import / export | ImportWizard, ExportDialog | Same props; stepper header, drop zone, summary tiles |
| Toasts | `@mantine/notifications` | `sonner` (optional peer, literal `import("sonner")`) |
| Theme bridge | `useGridThemeFromMantine` + CSS resolver | `useGridThemeFromShadcn` + tokens |

Known gaps:
- `.xls` import is not supported in either kit (`io` reads CSV and `.xlsx`).
- ag-grid's `DraftColumn` and `AddColumnPosition` types are derived locally from `SchemaGridProps` until
  ag-grid exports them.
