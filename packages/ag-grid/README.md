# @masai/schema-grid-ag-grid

An AG Grid (Community) binding for `@masai/schema-grid-core`: point it at a `GridSchema`, a `DataSource` and a
`GridUser`, and it compiles columns, wires permissions, editing, filtering, client/server row models and
optimistic writes on top of AG Grid, entirely inside the free Community tier.

Range selection, clipboard, the fill handle, undo/redo keybindings, grouping (client and server) and
polling are all wired into the grid; see "Interaction features" and "Keyboard and accessibility" below.

## Install

```bash
bun add @masai/schema-grid-ag-grid ag-grid-community ag-grid-react react react-dom
# optional, only needed for CSV/XLSX file export:
bun add @masai/schema-grid-io
```

### Peer dependencies

| Package | Version |
|---|---|
| `react` / `react-dom` | `^18.3.0` |
| `ag-grid-community` | `^36.0.0` |
| `ag-grid-react` | `^36.0.0` |
| `@masai/schema-grid-io` | any (**optional** — only required if you call `exportCurrentView`) |

## Enterprise-free guarantee

This package imports **only** AG Grid Community modules, and never registers them globally — every grid
receives its module list explicitly through the `modules` grid option. Nothing here imports, references, or
even writes the string of any Enterprise package name. The Community-only guarantee is enforced by
`test/noEnterprise.test.ts`.

The exact module set (from `src/agModules.ts`):

**Shared by both modes:**
`CustomEditorModule`, `CustomFilterModule`, `CellStyleModule`, `RowStyleModule`, `RowApiModule`,
`RenderApiModule`, `HighlightChangesModule`, `CsvExportModule`, `ColumnApiModule`, `EventApiModule`,
`RowSelectionModule`, `TextEditorModule`, `ScrollApiModule`

**Client mode adds:** `ClientSideRowModelModule`, `ClientSideRowModelApiModule`
**Server (infinite) mode adds:** `InfiniteRowModelModule`

Deliberately excluded: `UndoRedoEditModule` (we own undo ourselves), AG Grid's built-in text/number/date
filter modules (our filters are custom), and anything from `ag-grid-enterprise`.

## Quick start

```tsx
import { SchemaGrid } from "@masai/schema-grid-ag-grid";

<SchemaGrid
  schema={schema}
  dataSource={dataSource}
  user={{ id: "u1", roles: ["admin"] }}
/>;
```

Or drop down to the headless hook if you want to render `AgGridReact` yourself (e.g. to add your own toolbar
around it):

```tsx
import { AgGridReact } from "ag-grid-react";
import { useSchemaGrid } from "@masai/schema-grid-ag-grid";

function MyGrid() {
  const { gridProps } = useSchemaGrid({ schema, dataSource, user });
  return <AgGridReact {...gridProps} />;
}
```

`<SchemaGrid>` wraps this in a `.sg-root` container (which carries the root keyboard, `copy` and `paste`
listeners), mounts the two visually hidden live regions (polite + assertive), installs the range/fill
`CellShell` and the full-width group/load-more renderers, and exposes an imperative handle via `ref`:
`api()`, `undo()`/`redo()`, `canUndo()`/`canRedo()`, `exportCsv()`/`exportCurrentView()`, `captureView()`,
`refetch()`, `stores` and `announce(message, politeness?)`. When you render `AgGridReact` yourself through
`useSchemaGrid`, you get the same behaviour only for what you wire: pass an `announce` seam and attach
`keyboard.handleRootKeyDown` / `clipboard.onCopy` / `clipboard.onPaste` / `clipboard.rootRef` to your root.

## `useSchemaGrid` / `SchemaGrid` props

```ts
interface SchemaGridProps<Row extends GridRow = GridRow> {
  schema: GridSchema;
  dataSource: DataSource<Row>;
  user: GridUser;
  resolver?: PermissionResolver<Row>;        // default: createRolePermissionResolver()
  registry?: FieldTypeRegistry;              // default: createDefaultRegistry()
  uiRegistry?: UiFieldTypeRegistry<Row>;     // default: createDefaultUiRegistry()
  view?: ViewDef | null;
  onViewChange?(view: ViewDef): void;
  events?: SchemaGridEvents<Row>;
  mode?: "client" | "server";                // default "client"; must not change after mount
  tz?: string;                               // default DEFAULT_TZ
  io?: { buildExportBlob };                  // io's export module; default: import("@masai/schema-grid-io/export")
  pageSize?: number;                         // default 100
  pageMode?: "offset" | "cursor";            // default "offset"; server mode only
  externalFilter?: FilterNode | null;
  onClipboardReport?(report: ClipboardReport): void;
  poll?: { intervalMs?: number; enabled?: boolean };
  theme?: Theme;                             // default createSchemaGridTheme()
  popupParent?: HTMLElement | null;          // default document.body (null = AG Grid's default)
  floatingFilters?: boolean;                 // default false: the filter lives in the header cell
  headerMenu?: ComponentType<HeaderMenuProps>; // column menu UI; default DefaultHeaderMenu
  onGroupByColumn?(colId: string): void;     // "Group by" in the column menu
  onEditColumn?(colId: string): void;        // "Edit column…" in the column menu
  onInsertColumn?(colId: string, side: "left" | "right"): void;
  draftColumn?: DraftColumn | null;          // column-builder live preview (ghost / edit)
  onAddColumn?(position: AddColumnPosition): void; // renders the trailing "+" column
  gridOptions?: Partial<GridOptions<Row>>;   // escape hatch, see below
}
```

### Header, filters and the column menu

Every column uses `SchemaHeader`: the label (`.ag-header-cell-text`, label text only), a sort arrow, and
hover/focus-revealed controls — a filter button (`.sg-header-filter`, "Filter <label>", or
"Filter <label> (active)" while filtered, when it stays visible and accent-tinted) and a `⋯` column-menu
button (`.sg-header-menu`, "Column menu: <label>"). The floating-filter row is off by default
(`floatingFilters` opts back in to `FloatingFilter`). Keyboard on a focused header: Enter sorts (AG Grid);
Ctrl/Cmd+Enter, Shift+Enter or Alt+ArrowDown open the filter; Shift+F10 / ContextMenu open the column menu;
right-click opens it too. The menu is a slot (`headerMenu`, `HeaderMenuProps`/`HeaderMenuActions`); its
actions go through `applyColumnState`/`autoSizeColumns`, so they land in `onViewChange`.

### Booleans, read-only cells, grouping, drafts

- Boolean cells toggle in place (click the checkbox, Space or Enter) through the normal edit pipeline — no
  editor opens.
- Formula cells get `sg-cell-formula`, permission read-only cells `sg-cell-readonly`; trying to edit one
  announces why and briefly flashes `sg-cell-readonly-hint`.
- Group rows are 32px, render the group value with the column's own renderer, and support ←/→ to
  collapse/expand. Collapsed groups are captured into `ViewDef.collapsedGroups`.
- `draftColumn` "create" inserts a read-only ghost column (`__sg_draft__`); "edit" renders the real column
  with the draft's label/config. `onAddColumn` adds a trailing "+" column (`__sg_add__`, "Add column at
  end"). Neither synthetic column is ever captured into views, exported, copied or part of a range.

`useSchemaGrid(props, seams?)` returns:

```ts
interface UseSchemaGridResult<Row extends GridRow = GridRow> {
  gridProps: AgGridReactProps<Row>;          // spread onto <AgGridReact>
  api(): GridApi<Row> | null;
  stores: SchemaGridStores<Row>;             // row/cellStatus/range/query/expansion stores
  controller: EditController<Row>;
  undo: { undo(): Promise<void>; redo(): Promise<void>; canUndo(): boolean; canRedo(): boolean };
  exportCsv(fileName?: string): void;
  exportCurrentView(format: "csv" | "xlsx", fileName?: string): Promise<Blob>;
  captureView(): ViewDef | null;
  refetch(): Promise<void>;
  access: Map<string, Access>;               // per-column "hidden" | "read" | "edit"
  loadState: "idle" | "loading" | "error";
  lastError: unknown;
  filterErrors: { user: FilterValidationError[]; external: FilterValidationError[] };
  rowModelKey: "clientSide" | "infinite";
  poll: SchemaGridPollOptions | undefined;
}
```

### The `gridOptions` escape hatch

`gridOptions` is merged in last, but a fixed set of keys are **always ours** and cannot be overridden:
`readOnlyEdit`, `onCellEditRequest`, `rowModelType`, `modules`, `context`, `getRowId`, `rowData`, `datasource`,
`postSortRows`, `maintainColumnOrder`. A handful of event handlers we also set are **chained** instead of
overwritten — ours runs first, then yours: `onGridReady`, `onGridPreDestroyed`, `onSortChanged`,
`onFilterChanged`, `onColumnMoved`/`Resized`/`Visible`/`Pinned`. Anything else you pass (e.g. `domLayout`,
`rowHeight`) wins as-is.

`schema`, `dataSource`, `resolver`, `registry`, `uiRegistry` and `theme` are compared **by reference** — pass
stable instances (memoize them). `user` and `externalFilter` are compared **by value**. `mode` must not
change after the grid mounts.

## Client vs. server mode

- **`mode: "client"`** (default): every row is fetched up front (paged via `dataSource.fetch`, offset paging,
  `includeTotal`) into an in-memory row store. Filtering, sorting, search and grouping all run locally over
  that store. Best for datasets that comfortably fit in memory.
- **`mode: "server"`**: uses AG Grid's infinite row model. Each distinct effective query (filter + sort +
  search + groupBy) gets its own AG Grid `datasource`; header sort/filter changes re-request blocks from the
  grid itself, other query changes (search, groupBy, `externalFilter`) get a fresh datasource and jump back to
  the top.

### `pageMode`: offset vs. cursor

Server mode supports two paging strategies via `pageMode`:
- `"offset"` (default): blocks are requested as `{ offset, limit }` directly from AG Grid's block index.
- `"cursor"`: block 0 is `{ offset: 0, limit }`; every later block reuses the `nextCursor` returned by the
  previous block (`{ cursor, limit }`), cached per block index. Requesting a block whose cursor chain isn't
  known yet walks forward from the nearest known one. Use this when your backend paginates by opaque cursor
  rather than numeric offset.

## Talking to a server: `createHttpDataSource` / `createRemoteDataSource`

The grid only needs a `DataSource`; it does not care how that data source reaches your backend. Two helpers
build one over the transport-neutral wire contract (`@masai/schema-grid-core/wire`,
[`docs/wire-contract.md`](../../docs/wire-contract.md)):

```ts
import { createHttpDataSource, createRemoteDataSource, unwrapWireResult } from "@masai/schema-grid-ag-grid";

// REST / Express / Hono / API Gateway — anything mounted with @masai/schema-grid-server/http
const dataSource = createHttpDataSource({
  baseUrl: "/api/grid",                       // POST /api/grid/fetch, /api/grid/applyChanges, ...
  headers: async () => ({ authorization: `Bearer ${await getToken()}` }),
  credentials: "include",                      // optional, for cookie sessions
  // opPath: (op) => `?op=${op}`, fetch: customFetch, supports: { lookup: false }
});

// any other transport, e.g. a tRPC client returning the server's WireResult envelope
const viaTrpc = createRemoteDataSource(async (op, input) => unwrapWireResult(await trpc.grid.call.mutate({ op, input })));
```

Both validate responses against the wire schemas and throw `RemoteDataSourceError` (`code`, `status`,
`details`) for server-side failures — e.g. `PERMISSION_DENIED` (403), `FILTER_INVALID` (400),
`FORMULA_ROW_CAP` (413). `createHttpDataSource` expects `{ data }` on 2xx and `{ error }` otherwise; a non-2xx
without a wire body becomes `UNAUTHENTICATED` (401), `PERMISSION_DENIED` (403) or `HTTP_ERROR`. Network
failures propagate unchanged. Pass `supports: { getChanges: false, ... }` for optional operations your server
does not implement so the grid never calls them.

## `externalFilter` — a security note

`externalFilter` is meant for a **trusted, host-supplied** restriction (e.g. "only rows in this tenant"),
kept entirely separate from the user's own filter UI. It is validated against **all** schema columns (it may
reference columns hidden from the user), never shown in the column filter UI, and never captured into a
saved `ViewDef`.

- **Client mode:** applied with core's `matchesFilter` against every loaded row, before the user's filter,
  search and sort run.
- **Server mode:** AND-ed into the `filter` sent as part of `GridQuery`.

**In server mode, `externalFilter` is advisory to the client only — the server MUST enforce the real
restriction itself.** Nothing stops a modified client from omitting or altering the AND-ed filter before it
reaches your API; treat `externalFilter` as a UX convenience (avoids fetching/rendering rows the user
shouldn't see), never as your actual access-control boundary.

If `externalFilter` fails validation, the grid **fails closed**: zero rows, no fetch is issued, and the error
surfaces in `filterErrors.external` / `loadState: "error"`.

## Permissions (hidden / read / edit)

Column access is resolved once per render from `schema`, your `resolver` (default
`createRolePermissionResolver()`) and `user`, producing a `Map<columnId, Access>` where `Access` is
`"hidden" | "read" | "edit"`:

- **`hidden`** columns never appear as a grid column, never drive sort/search/groupBy/aggregation, and any
  user-filter condition referencing one is dropped (with an entry in `filterErrors.user`).
- **`read`** columns render normally but never enter edit mode, and are excluded from `onCellEditRequest`
  writes.
- **`edit`** columns are fully interactive.

Sort, search, group-by and view state are all pruned to the currently-readable column set before use — an
unreadable column can never leak through a saved `ViewDef` or a query either.

## Editing pipeline

All editing goes through `readOnlyEdit: true` + AG Grid's `onCellEditRequest` (never direct cell mutation),
which this package wires to a single internal `EditController`:

1. A cell edit, a paste or a fill all become a `ChangeBatch` (a list of `CellChange`).
2. Every change is applied **optimistically** to the row store immediately (no version bump yet) and marked
   pending (`sg-cell-pending`), so the UI never waits on the network to show the new value.
3. The batch is sent to `dataSource.applyChanges(batch)`. Batches touching the same row are serialized so
   quick successive edits never race each other.
4. **Success:** the row store adopts the server-normalised value, pending clears.
5. **Error:** the cell reverts to its value from before the batch and shows `sg-cell-error` with the message.
6. **Conflict:** the cell reverts, `onRowStale(rowIds)` fires once, then `onConflict(conflict, resolve)` is
   called per conflicting cell with two resolutions:
   - `"keepTheirs"` — adopt the server's value (default if you don't provide `onConflict`).
   - `"overwrite"` — re-submit your original value on top of the server's, through the same pipeline.

Rejected/vetoed edits (e.g. a `beforeCellsChange` hook returning `false`, or a permission failure) never
reach the data source at all.

Every outcome is announced in the live regions (see "Keyboard and accessibility"): success politely ("Saved"),
a veto, a conflict or a server-rejected cell assertively.

### Optimistic writes and `onRowStale`

Because writes apply to the row store before the network round-trip resolves, a slow connection never blocks
typing or navigating. `onRowStale` tells you which rows had a conflict; since resolving a conflict moves that
row's *whole* version forward (which can silently mask other remote changes to the same row), the host layer
refetches those rows in full rather than trusting the single conflicting cell in isolation.

## Extending the UI: `createDefaultUiRegistry()` and `UiFieldTypeRegistry`

Every built-in field type (text, number, date, boolean, select, …) has a `UiFieldType` entry — renderer,
optional editor, optional filter UI, optional export formatter:

```ts
export interface UiFieldType<Row extends GridRow = GridRow> {
  renderer: ComponentType<CustomCellRendererProps<Row>>;
  editor?: ComponentType<CustomCellEditorProps<Row>>;
  editorPopup?: boolean;
  editorPopupPosition?: "over" | "under";
  filterComponent?: ComponentType<CustomFilterProps<Row>>;
  floatingFilter?: ComponentType<CustomFloatingFilterProps>;
  exportFormat?(value: unknown, column: ColumnDef, fieldType: FieldType<unknown, unknown> | undefined): string;
}
```

`createDefaultUiRegistry<Row>()` builds the default registry. To customize just a piece of one type (say,
swap in your own date-picker but keep the default renderer/filter), branch it with `.extend(...)` — this
returns a **new** registry, it never mutates the one you called it on:

```ts
import { createDefaultUiRegistry } from "@masai/schema-grid-ag-grid";

const uiRegistry = createDefaultUiRegistry().extend({
  date: { editor: MyDatePickerEditor },
});

<SchemaGrid schema={schema} dataSource={dataSource} user={user} uiRegistry={uiRegistry} />;
```

`registry.get(id)` never returns `undefined` — an id with no explicit entry falls back to the `"text"` entry.
`registry.has(id)` tells you whether an id was explicitly registered (excluding that fallback).

## Popup editors: `createPopupEditor`

`createPopupEditor(Component, options?)` wraps any React component as an AG Grid **popup** cell editor,
handling focus retention, Enter/Tab/Esc forwarding, and commit/cancel plumbing for you:

```tsx
import { createPopupEditor } from "@masai/schema-grid-ag-grid/editors";

const MyPopupEditor = createPopupEditor<string>(({ value, onChange, commit, cancel }) => (
  <MySelect value={value} onChange={onChange} onConfirm={commit} onEscape={cancel} />
));
```

Your wrapped component receives `value`, `onChange(value)` (update without closing), `commit(value)` (report
and stop editing), `cancel()` (discard and stop editing), plus `schemaColumn`, `fieldType` and the raw AG Grid
`editorProps`.

### The Mantine `withinPortal={false}` requirement

**AG Grid treats a mousedown outside the popup's DOM subtree as "click outside → close/cancel the editor."**
Mantine's `Select`, `Combobox`, `MultiSelect`, etc. render their dropdown in a **portal** by default — outside
the popup editor's container — so clicking an option looks like an outside click to AG Grid and the editor
closes before the click is processed.

Fix it one of two ways:

1. **Preferred:** disable the portal so the dropdown renders inside the popup's own DOM subtree:
   ```tsx
   <Select withinPortal={false} ... />
   // or, for Combobox-based components:
   <Combobox comboboxProps={{ withinPortal: false }} ... />
   ```
2. **Alternative:** if you can't avoid a portal, tag the portalled element (or its container) with AG Grid's
   own marker class, `ag-custom-component-popup` — AG Grid treats clicks inside any element carrying that
   class as "inside the popup," regardless of where in the DOM it actually lives.

`createPopupEditor` also exposes `keepOpenOnOutsideClick`, which tags every outside-mousedown target with
`ag-custom-component-popup` for the duration of that one event — useful for editors with their own modal-ish
overlays that aren't Mantine.

## Subpath exports

```
@masai/schema-grid-ag-grid          – SchemaGrid, useSchemaGrid, compileColumns, createDefaultUiRegistry,
                                       UiFieldTypeRegistry types, captureViewState/applyViewState,
                                       exportCsv/exportCurrentView, createSchemaGridTheme, SG_CLASSES,
                                       SCHEMA_GRID_CLIENT_MODULES / SCHEMA_GRID_INFINITE_MODULES,
                                       store factories, planPaste/planFill, parseTsv/serializeTsv, createUndoStack,
                                       createHttpDataSource, createRemoteDataSource, RemoteDataSourceError,
                                       unwrapWireResult
@masai/schema-grid-ag-grid/editors  – the built-in editors, createPopupEditor, ComboboxEditor
@masai/schema-grid-ag-grid/filters  – the built-in filter components, filterModelToAst / astToFilterModel
@masai/schema-grid-ag-grid/sync     – usePollingSync, planRemotePatch, useDocumentVisible
```

Importing `./filters` does not pull in the grid component itself — pick the subpath that matches what you
actually need to keep bundle size down.

## Theming

`createSchemaGridTheme(overrides?)` returns an AG Grid `Theme` (Quartz-based) whose every color/font/spacing
value reads from a `--sg-*` CSS custom property, falling back to a sensible default when unset:

```ts
createSchemaGridTheme({
  accentColor: "#5e6ad2",         // var(--sg-accent-color)
  backgroundColor: "#ffffff",      // var(--sg-background-color)
  foregroundColor: "#09090b",      // var(--sg-foreground-color)
  borderColor: "#e4e4e7",          // var(--sg-border-color)
  headerBackgroundColor: "#fafafa", // var(--sg-header-background-color)
  rowHoverColor: "rgba(9, 9, 11, .025)", // var(--sg-row-hover-color)
  fontSize: 13,                    // var(--sg-font-size)
  rowHeight: 36,
  headerHeight: 36,
});
```

The defaults follow `docs/design/README.md` (Linear density, Vercel restraint): 36px rows and header, 12px
cell padding, horizontal hairlines only, 8px wrapper radius, no striping, accent-only selection/focus and a
soft shadow on popups only. `SCHEMA_GRID_THEME_PARAMS` exports the full default param set.

Rather than pass overrides, most consumers can just set the corresponding `--sg-*` CSS variables on an
ancestor element — no rebuild required. The grid also injects its own scoped decoration CSS (range
selection, pending/error/remote-changed cells, the fill handle, group/load-more rows, not-in-view rows) under
`.sg-root`, so none of it leaks onto the rest of your page. `SG_CLASSES` (from the main entry) gives you the
exact class name constants if you need to target them yourself; `SG_CSS` (raw string) is available from
`src/theme/classNames.ts` for a consumer that can't use the Theming API's part mechanism and needs to ship the
CSS as a plain stylesheet instead.

## Export: CSV and XLSX

- **`exportCsv(fileName?)`** — client mode: uses AG Grid's own `exportDataAsCsv` over the currently displayed
  rows/columns (readable, non-hidden columns only; group rows skipped; cell text formatted via the UI
  registry's `exportFormat`, falling back to the field type's `format`). Server mode: delegates to
  `exportCurrentView("csv", fileName)` and triggers a browser download of the result.
- **`exportCurrentView(format, fileName?)`** — pages the **full current query** through `dataSource.fetch`
  (not just the loaded/visible rows) and hands the **raw** rows + `ColumnDef`s to `@masai/schema-grid-io`'s
  browser-safe `buildExportBlob({ columns, registry, rows, format, tz, fileName, access })`, which types the
  cells itself (XLSX numbers, dates, hyperlinks). Resolves to that `Blob`.

`@masai/schema-grid-io` is an **optional peer dependency** — only `exportCurrentView` (and therefore
server-mode `exportCsv`, and any XLSX export) needs it. By default it is loaded with a literal
`import("@masai/schema-grid-io/export")` (bundlers resolve and code-split it); to avoid any lookup, pass it in:

```tsx
import * as io from "@masai/schema-grid-io/export";
<SchemaGrid io={io} ... />; // or exportCurrentView({ ..., io })
```

Without the package installed and no `io` prop, the call throws a clear error naming the missing package;
client-mode `exportCsv` works without it.

## Interaction features

### Range selection

AG Grid Community has no range module; `src/range/useRangeSelection.ts` implements one.

- **Mouse:** mouse-down on a cell anchors a range; dragging extends it while the primary button is held;
  Shift+click extends from the anchor. A right-click inside the range keeps it.
- **Keyboard:** Shift+Arrow extends the range (stepping over group, load-more and loading rows) and moves grid
  focus with it. Plain navigation (arrows, Tab, Enter) collapses the range to the focused cell.
- The range resets on sort/filter changes, when the rows under the anchor/focus change, or when the
  anchor/focus column disappears. Hidden columns are never part of a range; full-width, pinned and
  not-yet-loaded rows are ignored.
- Cells get `sg-cell-range` plus `sg-cell-range-top/right/bottom/left` edge classes; one batched
  `refreshCells` per change covers only the cells whose membership changed.
- A range larger than one cell is announced: "3 rows by 2 columns selected".
- Not in jsdom scope: edge autoscroll while dragging (Playwright scenario 1).

### Clipboard (copy / paste)

`src/clipboard/useClipboard.ts`, over the pure `buildCopyMatrix` / `planPaste` / `parseTsv` / `serializeTsv`.

- **Ctrl/Cmd+C** copies the range (or the focused cell) as TSV. Formula cells copy their result; a formula
  error copies as blank. **Ctrl/Cmd+V** pastes at the range's top-left (or focused cell).
- The native `copy`/`paste` events with `clipboardData` are preferred (permission-free, also serve menu
  copy/paste); when no native event arrives, it falls back to `navigator.clipboard.writeText`/`readText`.
  `document.execCommand` is never used. Nothing happens while a cell editor is open, so editors keep native
  text copy/paste.
- A paste is ONE `"paste"` batch (one undo step). Read-only and formula cells are skipped; unparsable
  values are reported as errors; creatable-select labels are created through `dataSource.createOption`
  (and `events.onOptionCreate` fires) before the batch is sent.
- The outcome goes to `onClipboardReport({ pastedCells, skippedReadOnly, conflicts, errors })` and is
  announced: "Paste: N pasted, M skipped, K errors" (+ ", C conflicts"). Failures announce "Paste failed" /
  "Copy failed"; empty text announces "Nothing to paste".

### Fill handle

`src/fill/useFillHandle.ts` + `src/range/CellShell.tsx`, over the pure `planFill`.

- The handle (`sg-fill-handle`) is rendered in the range's bottom-right cell only. Drag it **down** or
  **right** (the dominant axis wins, ties go down); the extension cells show `sg-cell-fill-preview`.
- On release, the series is extrapolated by `planFill` and sent as ONE `"fill"` batch; the range becomes the
  filled range. Esc (or pointer cancel) cancels without writing. Up/left fills are out of scope for v1.
- Read-only and formula cells are skipped. Once the save settles the outcome is announced as one message:
  "Fill: 3 cells filled, 1 read-only cell skipped, saved" (", N saved" when only some were applied).
- Limitations: no edge autoscroll while dragging; in server mode not-yet-loaded rows are skipped.

### Undo / redo

The grid records every applied batch (edit, paste, fill) in `createUndoStack` and replays inverted changes
through the normal edit pipeline (`"undo"` / `"redo"` sources), so a conflict during undo goes to
`onConflict` like any edit. A paste or fill is one step.

- **Ctrl/Cmd+Z** undoes; **Ctrl/Cmd+Shift+Z** and **Ctrl+Y** redo (`src/undo/useUndoKeybindings.ts`).
  Ignored while a cell editor is open (the editor's own undo wins).
- Announced: "Undone" / "Redone", or "Nothing to undo" / "Nothing to redo".
- Also exposed as `undo()` / `redo()` / `canUndo()` / `canRedo()` on the handle.

### Grouping

- **Client mode:** `view.groupBy` groups the derived rows with `buildClientGroups`; group headers are
  full-width rows (`sg-group-row`) with a toggle button (`aria-expanded`), the group label, row count and
  aggregates formatted with the aggregated column's field type, indented by level. Enter/Space on the toggle
  or on the focused group row expands/collapses (expansion store).
- **Server mode:** the infinite row model can't insert group rows, so while `groupBy` is set the grid
  switches to the client-side row model over lazily loaded groups (`src/server/serverGroups.ts`). Groups
  start collapsed; expanding a leaf group fetches its rows a page at a time with the view filter AND-ed with
  a pinned condition for every ancestor, and a full-width "load more" row (`sg-load-more-row`) appends the
  next page. Sub-groups come from the server's nested `children` or a query with the remaining `groupBy`
  levels. Expansion survives refetches. Removing `groupBy` switches back to the infinite model.

### Polling (live sync)

When the data source implements `getChanges`, the grid polls it (`src/sync/applyRemotePatch.ts` +
`usePollingSync`): `poll.enabled` defaults to document visibility, `poll.intervalMs` defaults to 7000 ms, with
exponential backoff on errors (capped at 60 s) and never more than one request in flight.

- Newer remote rows are applied (client: through the row store; server: `setData` on loaded nodes) and the
  exact changed cells flash; they're also marked `sg-cell-remote-changed`.
- A row that no longer matches the view keeps its place with `sg-row-not-in-view` until the next refetch.
- A remote change to a row with a cell being edited (or pending) is deferred and re-planned when editing
  stops / pending clears; a later local commit on a remotely changed cell conflicts and goes to `onConflict`.
- Emits `events.onRemoteChanges(entry)`, and `events.onSchemaChanged(version)` when the feed reports a new
  schema version.

## Keyboard and accessibility

### Keyboard shortcuts

| Key | Effect |
|---|---|
| Enter / F2 / typing | Start editing the focused editable cell (read-only cells never enter edit mode) |
| Enter (editing) | Commit and move down one row (`enterNavigatesVerticallyAfterEdit`) |
| Tab / Shift+Tab (editing) | Commit and move to the next / previous **editable** cell, which starts editing |
| Esc (editing) | Cancel: the value is restored, nothing is written |
| Arrows | Move focus; collapses the range |
| Shift+Arrow | Extend the range |
| Ctrl/Cmd+C, Ctrl/Cmd+V | Copy / paste the range |
| Ctrl/Cmd+Z | Undo |
| Ctrl/Cmd+Shift+Z, Ctrl+Y | Redo |
| Esc (while dragging the fill handle) | Cancel the fill |
| Enter / Space (group row) | Expand / collapse the group |

Tab while editing skips non-editable cells (formula columns, read-only permissions) with no custom
`tabToNextCell`: in AG Grid 36, `moveToNextEditingCell` → `findNextCellToFocusOn({ startEditing: true })`
skips cells whose `isCellEditable` is false unless `editType: "fullRow"`. Tab when NOT editing moves to the
next cell, editable or not (AG default). Popup editors built with `createPopupEditor` forward Enter/Tab/Esc to
the grid.

### Live-region announcements

`<SchemaGrid>` renders a polite (`role="status"`) and an assertive (`role="alert"`) visually hidden live
region. All wording is built in `src/a11y/announcer.ts`; an identical consecutive message is re-announced.

| Event | Message | Politeness |
|---|---|---|
| Edit / paste / undo applied | "Saved" / "Saved N cells" | polite |
| Conflict (one cell / several) | "Conflict on {column}, row {id}" / "Conflicts on N cells" | assertive |
| Server rejected a cell (one / several) | "Edit rejected on {column}: {reason}" / "N edits rejected" | assertive |
| `beforeCellsChange` veto | "Edit cancelled" | assertive |
| Paste | "Paste: N pasted, M skipped, K errors" (+ ", C conflicts") | polite |
| Fill (after its save settles; no separate "Saved") | "Fill: N cells filled, M read-only cells skipped, saved" | polite |
| Range | "R rows by C columns selected" | polite |
| Undo / redo | "Undone" / "Redone" / "Nothing to undo" / "Nothing to redo" | polite |
| Clipboard failure | "Copy failed" / "Paste failed" | assertive |

Conflict / rejected / veto messages are not announced for paste batches (the paste summary already counts
them). Hosts can announce their own messages through the handle's `announce(message, politeness?)`.
