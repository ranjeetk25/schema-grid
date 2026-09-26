# Bundle size

How to see what schema-grid costs in a browser bundle, which AG Grid modules
it pulls in, and what changed in v0.2.

## Running the analysis

```bash
bun run analyze
```

This runs `ANALYZE=1 storybook build` in `apps/storybook`, then
`apps/storybook/scripts/report-chunks.ts`. The Storybook preview is a real Vite
production build (minified, tree-shaken) of every workspace package from its
TypeScript source, so it is the closest thing in the repo to "an app that uses
schema-grid". With `ANALYZE` set, `.storybook/main.ts` adds two
`rollup-plugin-visualizer` instances to the preview build:

| File | What it is |
|---|---|
| `apps/storybook/storybook-static/bundle-stats.html` | Treemap (with gzip sizes). Open it in a browser. |
| `apps/storybook/storybook-static/bundle-stats.json` | The same data as `raw-data` JSON; input for the report script. |

`storybook-static/` is git-ignored. To re-print the report without rebuilding:
`cd apps/storybook && bun scripts/report-chunks.ts` (`--json` for a
machine-readable version).

## Reading the report

The report has four sections.

1. **JS chunks: preview**. Every emitted JS file of the Vite preview build,
   largest first, with raw and gzip (level 9) size in KB. `Workbench-*.js` is
   the chunk that holds the grid, AG Grid, Mantine and the schema-grid
   packages. `DocsRenderer-*`, `entry-preview-docs-*`, `iframe-*` and
   `__vite-browser-external-*` (mostly exceljs) are Storybook or story-only
   code.
2. **JS chunks: storybook-manager**. Storybook's own prebuilt UI (`sb-*`).
   It is not affected by our code; it is listed so the total is honest.
3. **Rendered size by package**. From `bundle-stats.json`: bytes each package
   contributes after tree-shaking (before minification, so larger than its
   share of the minified chunk). `packages/*` rows are our workspace packages.
   Below it are per-file listings for `@tabler/icons-react` and
   `ag-grid-community`.
4. **AG Grid Community modules**. See below.

## AG Grid modules

`@ranjeetk25/schema-grid-ag-grid` never uses the global `ModuleRegistry` and
never imports `AllCommunityModule`. `SchemaGrid` passes a per-grid `modules`
list chosen by row model, from `packages/ag-grid/src/agModules.ts`:

| Module | Client (`SCHEMA_GRID_CLIENT_MODULES`) | Infinite (`SCHEMA_GRID_INFINITE_MODULES`) |
|---|---|---|
| CustomEditorModule | yes | yes |
| CustomFilterModule | yes | yes |
| CellStyleModule | yes | yes |
| RowStyleModule | yes | yes |
| RowApiModule | yes | yes |
| RenderApiModule | yes | yes |
| HighlightChangesModule | yes | yes |
| CsvExportModule | yes | yes |
| ColumnApiModule | yes | yes |
| EventApiModule | yes | yes |
| RowSelectionModule | yes | yes |
| TextEditorModule | yes | yes |
| ScrollApiModule | yes | yes |
| ClientSideRowModelModule | yes | |
| ClientSideRowModelApiModule | yes | |
| InfiniteRowModelModule | | yes |

Deliberately left out: `UndoRedoEditModule` (schema-grid owns undo), the
Text/Number/Date filter modules (the filters are custom), everything
Enterprise.

`ag-grid-community` ships as one pre-bundled ESM file, so the visualizer can
only show it as a single 1.5 MB node. The report therefore checks the emitted
chunks for each module's `moduleName` and compares that set against the
closure of:

- the modules listed above,
- their `dependsOn` (read from `ag-grid-community/dist/package/main.esm.mjs`),
- `CommunityCoreModule` and its `dependsOn`, which `createGrid` always
  registers itself whatever `modules` you pass.

Result on this branch (ag-grid-community 36.2.0):

- transitive `dependsOn` of our lists (14): ColumnFilter, CsrmSsrmSharedApi,
  EditCore, FilterCore, FilterValue, InfiniteRowModelCore, Popup,
  RowModelSharedApi, SharedExport, SharedMenu, SharedRowSelection, Sort,
  SsrmInfiniteSharedApi, Tooltip.
- CommunityCore baseline (24): AnimationFrame, Aria, AutoWidth,
  CellRendererFunction, ChangeDetection, CheckboxCellRenderer,
  ColumnDelayRender, ColumnFlex, ColumnGroup, ColumnGroupHeaderComp,
  ColumnHeaderComp, ColumnMove, ColumnResize, CommunityCore, DataType, Drag,
  Expression, HorizontalResize, KeyboardNavigation, Overlay, PinnedColumn,
  SharedDragAndDrop, SkeletonCellRenderer, Touch.
- found in the bundle: 54 modules, which is exactly listed (16) + dependsOn
  (14) + baseline (24).
- **listed but not found: none. Found but not listed or required: none.**

So only the listed Community modules and what they (or the grid core) require
end up in the bundle. The 30-odd other Community modules (Text/Number/Date
filters, Pagination, QuickFilter, GridState, PinnedRow, the other editors, and
so on) are tree-shaken out. The `ag-grid-community` file still renders at
about 1.5 MB before minification because the grid core itself is large; that
part cannot be reduced from our side.

## Tabler icons in `ui-mantine`

`@ranjeetk25/schema-grid-ui-mantine` used to import icons from the
`@tabler/icons-react` barrel. In v0.2 every icon comes from
`packages/ui-mantine/src/internal/icons.ts`, which imports each one from its
own module (`@tabler/icons-react/dist/esm/icons/<Name>.mjs`, 52 icons) and
re-types it as the barrel's `TablerIcon`, so public types are unchanged:

- The per-icon files have no typings of their own;
  `src/internal/tabler-icons.d.ts` declares them.
- The CJS build must not `require()` those ESM-only files. A small esbuild
  plugin in `packages/ui-mantine/tsup.config.ts` replaces `icons.ts` with a
  re-export from the CJS barrel for `format: "cjs"` only. The ESM build
  (`dist/*.js`) imports the per-icon files, and `@tabler/icons-react` stays
  external in both.
- To add an icon, import it in `icons.ts` the same way and export it.

What this saves depends on the consumer's tooling. The barrel re-exports
6,221 icon modules and is marked `sideEffects: false`, so a production
Rollup/Vite build already tree-shakes it well. The per-icon imports matter
where nothing tree-shakes: the Vite dev server, vitest, and any consumer that
bundles without tree-shaking. Measured with esbuild over the exact 52-icon set
ui-mantine uses:

| Import style | Modules parsed | Tree-shaking on (raw / gzip) | Tree-shaking off (raw / gzip) |
|---|---|---|---|
| Barrel `from "@tabler/icons-react"` | 6,226 | 25.1 KB / 4.5 KB | 4,075 KB / 565 KB |
| Per-icon (`src/internal/icons.ts`) | 55 | 28.0 KB / 5.1 KB | 27.9 KB / 5.1 KB |

The ~3 KB difference with tree-shaking on (unminified) is the `icons.ts`
module itself: one typed `const` alias per icon.

## Before / after (Storybook preview build)

Measured with `bun run analyze` on this branch, before and after the icon
change. Sizes in KB, gzip at level 9.

| Chunk | Before raw | Before gzip | After raw | After gzip |
|---|---:|---:|---:|---:|
| `Workbench-*.js` (grid + AG Grid + Mantine + schema-grid) | 1,575.5 | 452.4 | 1,581.2 | 454.4 |
| `__vite-browser-external-*.js` (exceljs, Node shims) | 948.2 | 273.5 | 948.2 | 273.5 |
| `DocsRenderer-*.js` (Storybook docs) | 866.7 | 268.5 | 866.7 | 268.5 |
| `entry-preview-docs-*.js` (Storybook) | 241.3 | 71.4 | 241.3 | 71.4 |
| `iframe-*.js` (Storybook preview runtime) | 208.2 | 70.3 | 208.2 | 70.3 |
| `Switch-*.js` (Mantine shared) | 186.0 | 57.6 | 186.0 | 57.6 |
| `ImportExport.stories-*.js` | 47.7 | 16.9 | 46.5 | 16.6 |
| **Total preview JS (36 files)** | **4,428.1** | **1,331.2** | **4,432.6** | **1,332.8** |
| Storybook manager UI (`sb-*`, 13 files) | 2,732.5 | 765.8 | 2,732.5 | 765.8 |

| Package (rendered, after tree-shaking) | Before | After |
|---|---:|---:|
| `@tabler/icons-react` | 28.9 KB, 58 files | 29.0 KB, 58 files |
| `ag-grid-community` | 1,521.7 KB | 1,521.7 KB |
| `packages/ag-grid` | 284.8 KB | 290.5 KB |
| `packages/ui-mantine` | 311.0 KB | 313.5 KB |
| `packages/core` | 146.1 KB | 148.1 KB |

How to read this:

- The icon change does **not** move the production bundle: Rollup was
  already dropping the unused 6,000+ icons (58 icon files before and after).
  The gain is in dev and test, as the esbuild table shows.
- The `Workbench` chunk grew by about 6 KB raw / 2 KB gzip between the two
  runs. That comes from other v0.2 work that landed in `packages/ag-grid` and
  `packages/core` between the measurements (column capabilities), not from the
  icons. `packages/ui-mantine` gained 2.5 KB rendered, of which the new
  `icons.ts` module is 2.0 KB before minification.
- The Storybook app's own stories still import from the barrel
  (`apps/storybook/src/support/Workbench.tsx` and a few stories). That does
  not change the production numbers, for the same reason.

## v0.3: lazy io, exceljs in its own chunk

A consumer page measured its chunk growing from 2.1 to 3.2 MB when the
workbench came in, ~950 KB of it exceljs. In v0.3 the XLSX code paths of
`@ranjeetk25/schema-grid-io` load exceljs with `await import()` (only
`buildXlsxBlob`, `buildXlsxStream` and `parseXlsxBytes` touch it; CSV never
does — a vitest module mock that throws on evaluation guards that), and both
workbenches load `@ranjeetk25/schema-grid-io/*`, the Import wizard, the
Export dialog and the column panel on first use (`React.lazy` / dynamic
`import()`).

Measured with `bun run analyze` on 0.2.0 (before) and on this branch (after):

| Chunk | Before raw | Before gzip | After raw | After gzip |
|---|---:|---:|---:|---:|
| Main workbench chunk (grid + AG Grid + Mantine + schema-grid) — `__vite-browser-external-*.js` before, `Workbench-*.js` after | 2,599.2 | 752.1 | 1,556.9 | 447.7 |
| `exceljs.min-*.js` (lazy, XLSX only) | — (inside the main chunk) | — | 918.2 | 263.6 |
| `papaparse.min-*.js` (lazy, CSV import/export) | — (inside the main chunk) | — | 20.7 | 7.7 |
| `ColumnPanel-*.js` (lazy) | — | — | 61.4 | 20.5 |
| `ImportWizard-*.js` + `validate-*.js` (lazy) | — | — | 34.4 | 12.7 |
| `ExportDialog-*.js` (lazy) | — | — | 7.0 | 2.9 |

The eager cost of a page that renders the workbench fell by ~1,040 KB raw /
~305 KB gzip; exceljs is fetched only when someone exports or imports XLSX.
The main chunk is still above the 1.3 MB target: `ag-grid-community` alone
renders 1,521.7 KB before minification and `@mantine/core` 414 KB, so the
remaining reduction has to come from AG Grid module selection or from the
host splitting Mantine, not from schema-grid code (`packages/ui-mantine`
390 KB, `packages/ag-grid` 292 KB, `packages/core` 152 KB rendered).
