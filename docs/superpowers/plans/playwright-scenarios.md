# Playwright scenarios — `@masai/schema-grid-ag-grid`

Status: **spec only**. Playwright is not installed in this repo yet; nothing here has been run. This is the
hand-off for whoever wires up the storybook app + Playwright runner. Each scenario below is exercised against
a real browser because it depends on native drag/mouse/clipboard/focus behaviour that jsdom cannot simulate;
the logic behind each one is already tested in jsdom, listed under "Covered by."

Conventions used below:
- DOM classes are from `src/theme/classNames.ts` (`SG_CLASSES`): `sg-cell-range`, `sg-cell-range-top/right/bottom/left`,
  `sg-cell-pending`, `sg-cell-error`, `sg-cell-remote-changed`, `sg-row-not-in-view`, `sg-fill-handle`,
  `sg-cell-fill-preview`, `sg-group-row`, `sg-load-more-row`.
- "Live region" = the two visually hidden regions rendered by `LiveAnnouncer` inside `.sg-root`: polite
  (`role="status"`, class `sg-live-polite`) and assertive (`role="alert"`, class `sg-live-assertive`). All wording
  comes from `packages/ag-grid/src/a11y/announcer.ts`.
- "Covered by" lists the real package test files (paths from the repo root) that already exercise the logic
  in jsdom; each scenario covers what jsdom cannot.
- Every scenario needs a storybook story or fixture that mounts `<SchemaGrid>` with a known schema/rows and a
  data source that a test can control (in-memory or mockable network).

---

## 1. Range drag with autoscroll

**Preconditions:** a story with more rows than fit the viewport (so autoscroll near an edge triggers), client mode.

**Steps:**
1. Click a cell near the top of the visible rows to anchor a range.
2. Mouse-down on that cell, drag toward the bottom edge of the grid viewport, and hold there without releasing.
3. Wait for the grid to autoscroll several rows, then release the mouse over a newly-revealed row.

**Expected:**
- The dragged range grows continuously as the mouse moves, including through the autoscrolled rows.
- The released range's cells all carry `sg-cell-range`; the outer edge of the selection carries the matching
  `sg-cell-range-top/right/bottom/left` edge classes.
- No cells outside the final rectangle keep a range class after release.

**Covered by:** `packages/ag-grid/test/range/geometry.test.ts` (rectangle math, `rangeDiff`, edges) and `packages/ag-grid/test/range/useRangeSelection.test.tsx` (mousedown/drag/mouseup wiring, drag announces once on release). jsdom can't drive a real drag or edge autoscroll: `it.todo("real mouse drag across cells and edge autoscroll")` in `useRangeSelection.test.tsx` points here.

---

## 2. Shift+Arrow across pinned columns

**Preconditions:** a story with at least one pinned-left and one unpinned column, client mode.

**Steps:**
1. Click a cell in the pinned column to anchor a range.
2. Press Shift+ArrowRight repeatedly until the range crosses from the pinned column into the unpinned columns.
3. Press Shift+ArrowDown once.

**Expected:**
- The range extends seamlessly across the pin boundary (no gap, no reset) — cells in both the pinned and
  unpinned sections carry `sg-cell-range` for the full rectangle.
- Edge classes (`sg-cell-range-top/right/bottom/left`) move to the new rectangle boundary after each key press.

**Covered by:** `packages/ag-grid/test/range/useRangeSelection.test.tsx` (Shift+Arrow extends and suppresses the grid default; steps over full-width rows; stops at the edge; a pinned row is not handled) and `packages/ag-grid/test/range/geometry.test.ts`. The pinned-column boundary itself needs real layout, hence this scenario.

---

## 3. Fill handle down and right with a series

**Preconditions:** a story with a numeric or date column containing a short recognizable series (e.g. 1, 2 in
two adjacent cells), client mode.

**Steps:**
1. Select the two seed cells as a range.
2. Drag the fill handle (bottom-right corner of the range, class `sg-fill-handle`) down 5 rows.
3. Release, then repeat starting from a single-column seed dragged right across 3 columns of the same type.

**Expected:**
- While dragging, the cells about to be filled show `sg-cell-fill-preview`.
- After release, the filled cells contain the extrapolated series (e.g. 3, 4, 5, 6, 7 downward), matching the
  same rule `planFill` uses.
- Read-only or unreadable cells inside the drag path are skipped (left unfilled), not overwritten.
- The fill is one entry in the undo stack (see scenario 13).

**Covered by:** `packages/ag-grid/test/fill/fillPlan.test.ts` (series extrapolation, read-only skipping) and `packages/ag-grid/test/fill/useFillHandle.test.tsx` (axis lock, ONE `"fill"` batch, Esc cancel, preview refresh, integration drag through the real grid). Undo of a fill: `packages/ag-grid/test/undo/undoWiring.test.tsx`.

---

## 4. Fill across virtualised rows

**Preconditions:** a story with enough rows that the middle of the fill range is virtualised (not rendered)
when the drag starts, client mode.

**Steps:**
1. Select a seed range near the top of the grid.
2. Drag the fill handle far enough down that AG Grid needs to virtualise/recycle rows mid-drag.
3. Release at the bottom.

**Expected:**
- Rows that scrolled through virtualisation during the drag still receive the correct filled value once
  rendered (no "gap" of unfilled or stale cells where recycling happened).
- Same series/skip rules as scenario 3 apply to the full range, not just the initially-rendered rows.

**Covered by:** `packages/ag-grid/test/fill/fillPlan.test.ts` (plans over row data, not rendered rows) and `packages/ag-grid/test/fill/useFillHandle.test.tsx`, whose `it.todo("real drag of the fill handle, including fills that cross virtualised rows")` points here (jsdom tests run with virtualisation off).

---

## 5. OS clipboard round-trip (Google Sheets / Excel, quoted multiline cells)

**Preconditions:** a story with a long-text column, client or server mode.

**Steps:**
1. In an external spreadsheet app (Google Sheets or Excel), select a small block including at least one cell
   with an embedded newline and a cell containing a comma, copy it.
2. Click a top-left target cell in the grid and paste (Ctrl/Cmd+V).
3. Select the pasted range in the grid and copy it back (Ctrl/Cmd+C), then paste into the external app in a
   fresh location.

**Expected:**
- The multiline cell lands as a single cell value (not split into extra rows/columns); the comma-containing
  cell is not split into extra columns.
- The round-tripped value in the external app matches the original, including the embedded newline, using
  TSV with quoted fields.
- The paste is reported through `onClipboardReport` (see scenario 6) even on a clean paste.

**Covered by:** `packages/ag-grid/test/clipboard/tsv.test.ts` (`parseTsv`/`serializeTsv` quoting and newline rules), `packages/ag-grid/test/clipboard/copyPlan.test.ts`, `packages/ag-grid/test/clipboard/pastePlan.test.ts` and `packages/ag-grid/test/clipboard/useClipboard.test.tsx` (keydown, native event and `readText` fallback paths through the real grid), whose `it.todo("real OS clipboard round-trip with Sheets-formatted text")` points here.

---

## 6. Paste into a range containing read-only cells (report)

**Preconditions:** a story whose schema mixes editable and read-only columns (permission variant from
`test/fixtures/schema.ts`), client mode.

**Steps:**
1. Copy a rectangular block from the grid (or an external app) sized to cover both editable and read-only
   columns.
2. Paste it onto a target range that includes at least one read-only cell and one editable cell with a value
   that will fail validation for its column type.

**Expected:**
- Editable, valid cells are written; the read-only cell is left unchanged.
- `onClipboardReport` fires with counts that distinguish pasted vs. skipped (read-only) vs. errored
  (validation failure) cells.
- The live region announces a paste summary in the "Paste: N pasted, M skipped, K errors" shape.

**Covered by:** `packages/ag-grid/test/clipboard/pastePlan.test.ts` (read-only/validation skip logic), `packages/ag-grid/test/clipboard/useClipboard.test.tsx` (`onClipboardReport` counts, the "Paste: …" announcement) and `packages/ag-grid/test/a11y/announcements.test.tsx` (paste summary in the polite region, nothing assertive).

---

## 7. Focus stays in Mantine popup editors with `withinPortal={false}` (and is lost without it — negative test)

**Preconditions:** a story using a Mantine-backed popup editor (e.g. a select/combobox editor built with
`createPopupEditor`) configured correctly (`withinPortal={false}` / `comboboxProps={{ withinPortal: false }}`).
A second story (or a documented variant) intentionally misconfigures the same editor with portalling left on,
to serve as the negative test.

**Steps (positive):**
1. Double-click a cell using the popup editor to open it.
2. Click the Mantine dropdown to open its options list, then click an option.
3. Tab away from the cell.

**Expected (positive):**
- The dropdown's options render, click selection works, and focus never appears to leave the grid/editor (no
  focus-lost console warnings); the popup editor commits and the grid moves focus on Tab as normal.

**Steps (negative, documents the failure mode — this is deliberately expected to fail without the fix):**
1. Repeat the same steps against the misconfigured (portal-enabled) variant.

**Expected (negative):**
- Clicking the dropdown option is treated by AG Grid as an "outside click" (because the portalled dropdown
  renders outside `.ag-custom-component-popup`), closing/cancelling the editor before the click registers,
  or losing focus back to the document body. This documents *why* `withinPortal={false}` (or the
  `ag-custom-component-popup` class alternative) is required — see `src/editors/createPopupEditor.tsx`.

**Covered by:** none directly (a real-DOM focus/portal interaction). `createPopupEditor`'s focus retention and Enter/Tab/Esc forwarding are covered in jsdom by `packages/ag-grid/test/editors/editors.test.tsx`, whose `it.todo("focus stays inside real popup editors while tabbing/clicking")` points here.

---

## 8. Creatable select creating an option

**Preconditions:** a story with a select/combobox column configured as creatable (per T18's rich/creatable
combobox editor), client mode.

**Steps:**
1. Double-click a cell to open the combobox editor.
2. Type a value that doesn't match any existing option.
3. Trigger the "create" action (e.g. click the "Create '<value>'" row) and confirm.

**Expected:**
- The new option becomes the cell's committed value.
- The option is available for subsequent edits in the same session (e.g. reopening the editor on another
  cell of the same column shows it in the list), per whatever persistence contract the combobox editor
  documents (local-only vs. calling back to the host).

**Covered by:** `packages/ag-grid/test/editors/comboboxEditor.test.tsx` (creatable combobox: create flow, `createOption`, `onOptionCreate`) and `packages/ag-grid/test/clipboard/useClipboard.test.tsx` (pasting a new creatable label).

---

## 9. Conflict prompt: keepTheirs and overwrite with two browser contexts

**Preconditions:** two Playwright browser contexts (simulating two users/tabs) pointed at the same backing
data source (a shared in-memory or mock server keyed by row id/version), client or server mode.

**Steps:**
1. In context A, open the grid and start editing a cell but don't commit yet (or commit slowly enough to
   overlap).
2. In context B, edit and commit the *same* cell to a different value first.
3. In context A, commit the edit.
4. Repeat the scenario twice: once resolving the resulting conflict with "keepTheirs", once with "overwrite".

**Expected:**
- Context A's commit surfaces a conflict (`onConflict`) naming the cell/column; the cell shows
  `sg-cell-error`/pending state is cleared appropriately while the conflict is open.
- "keepTheirs": the cell ends up showing context B's value; the live region announces "Conflict on
  {column}, row {id}"; a subsequent `sg-cell-remote-changed` flash may appear once the row refetches.
- "overwrite": the cell ends up showing context A's original value after the re-submit round-trip.
- Context B's tab, if still open and polling/subscribed, eventually reflects the final resolved value.

**Covered by:** `packages/ag-grid/test/editing/editController.test.ts` (keepTheirs/overwrite, coalesced re-submits, `onRowStale`), `packages/ag-grid/test/sync/pollingWiring.test.tsx` (a commit on a remotely changed cell conflicts through `onConflict`), `packages/ag-grid/test/undo/undoWiring.test.tsx` (conflict during undo) and `packages/ag-grid/test/a11y/announcements.test.tsx` ("Conflict on Name, row r1" in the assertive region).

---

## 10. Polling highlight and remoteChanged marker while editing

**Preconditions:** a story with `poll` enabled (`SchemaGridPollOptions`), and a way to inject a remote change
into the underlying data source's change feed while the story is open (e.g. a debug button or a second
context editing the same row).

**Steps:**
1. Open the grid with polling enabled and note a row's initial values.
2. Start editing one cell in that row (open the editor, don't commit).
3. From another context or a debug trigger, change a *different* cell in the same row on the backend.
4. Wait for the next poll tick to pick up the change.
5. Commit the in-progress edit.

**Expected:**
- The remotely-changed cell flashes with `sg-cell-remote-changed` once the poll applies it; the cell being
  actively edited is not clobbered mid-edit.
- The in-progress edit still commits normally afterward, against the correct base version (no spurious
  conflict caused purely by the unrelated remote change).

**Covered by:** `packages/ag-grid/test/sync/planRemotePatch.test.ts`, `packages/ag-grid/test/sync/applyRemotePatch.test.ts`, `packages/ag-grid/test/sync/usePollingSync.test.ts` (timer chaining, backoff, generations), `packages/ag-grid/test/sync/useDocumentVisible.test.ts` and `packages/ag-grid/test/sync/pollingWiring.test.tsx` (real grid: remote edit applied and flashed, deferred while editing, later commit conflicts).

---

## 11. `notInView` row styling

**Preconditions:** client mode, a story whose data source can simulate a row that no longer matches the
current filter/sort after a remote patch (e.g. a status column driving the active filter).

**Steps:**
1. Apply a filter that includes a given row.
2. Trigger a remote patch that changes that row so it would no longer match the filter (simulating another
   user editing it away from the current view).
3. Observe the row without touching the filter.

**Expected:**
- The row is not immediately removed from the grid; it renders with `sg-row-not-in-view` (reduced opacity per
  the CSS in `classNames.ts`) at its prior position.
- Re-running/clearing the filter (or a manual refetch) removes the row once it's confirmed out of scope.

**Covered by:** `packages/ag-grid/test/sync/planRemotePatch.test.ts` / `packages/ag-grid/test/sync/applyRemotePatch.test.ts` (flag instead of remove), `packages/ag-grid/test/grid/useSchemaGrid.test.tsx` (notInView rows kept at their previous position) and `packages/ag-grid/test/sync/pollingWiring.test.tsx` (the row gets `sg-row-not-in-view`; refetch clears it). This scenario proves the CSS actually renders faded.

---

## 12. Group expand and lazy load in server mode

**Preconditions:** server (infinite) mode, a story with `groupBy` set and a data source that returns groups
with children loaded on demand.

**Steps:**
1. Open the grid; observe collapsed group rows (`sg-group-row`).
2. Click to expand a group whose children haven't been fetched yet.
3. Scroll to the bottom of a large group to trigger a "load more" row (`sg-load-more-row`) and click/scroll
   into it.

**Expected:**
- Expanding a group triggers exactly the fetch needed for that group's first page of children (no full
  re-fetch of the whole dataset).
- The "load more" row fetches the next page of that group's children and is replaced by the new rows (or
  disappears once the group is exhausted).
- Group header rows show correct aggregate values once children are loaded (per the schema's
  `aggregations`).

**Covered by:** `packages/ag-grid/test/grouping/clientGroups.test.ts`, `packages/ag-grid/test/grouping/groupCondition.test.ts` and `packages/ag-grid/test/grouping/groupingWiring.test.tsx` (real grid: full-width group rows, counts, aggregates, Enter toggles; server mode switches to the client-side model, expanding fetches with the pinned condition, nested pins, load-more appends, removing groupBy switches back). This scenario adds real scrolling/clicking.

---

## 13. Undo of paste and fill

**Preconditions:** client mode, a story with an editable range of at least 2x2 cells.

**Steps:**
1. Paste a multi-cell block (see scenario 5/6) onto the grid.
2. Trigger undo (Ctrl/Cmd+Z or an exposed undo button/keybinding).
3. Perform a fill operation (scenario 3).
4. Trigger undo, then redo (Ctrl/Cmd+Shift+Z or Ctrl+Y).

**Expected:**
- Undo after paste reverts every cell the paste touched back to its pre-paste value in one step (not one
  step per cell).
- Undo after fill reverts the whole filled range in one step.
- Redo re-applies the same batch and produces the same end state as before the undo.
- Both operations go through the normal edit pipeline on undo/redo (so a conflict during undo/redo is
  possible and handled the same way as a normal edit — see scenario 9).

**Covered by:** `packages/ag-grid/test/undo/undoStack.test.ts` (batch grouping, undo/redo semantics) and `packages/ag-grid/test/undo/undoWiring.test.tsx` (real grid: Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z, Ctrl+Y, a paste reverted in one batch, ignored inside an editor).

---

## 14. CSV download contents

**Preconditions:** both client and server mode stories, with a mix of hidden and read-only columns in the
schema.

**Steps:**
1. In the client-mode story, apply a filter/sort, then trigger the CSV export action.
2. In the server-mode story, trigger "export current view" (which pages the full query through the data
   source, not just what's rendered) and download the file.
3. Open both downloaded CSV files.

**Expected:**
- Client export: columns are limited to displayed, readable columns, in their current display order; hidden
  and unreadable columns are absent. Cell values are formatted per the column's `exportFormat` (or the field
  type's default `format`), not raw internal values (e.g. dates render as their display string, not epoch
  ms).
- Server export: contains every row matching the current query across all pages, not just the currently
  loaded/visible block.
- Group rows are absent from both exports (data rows only).

**Covered by:** `packages/ag-grid/test/export/export.test.ts` (`columnKeys` exclusion, formatting, paging until done against a mocked io); this scenario proves the actual downloaded file's bytes in a real browser download.

---

## 15. Keyboard-only Enter, Esc and Tab flows

**Preconditions:** client mode, a story with a mix of text, select and popup-editor columns.

**Steps:**
1. Using only the keyboard, navigate to an editable text cell (arrow keys), press Enter to start editing,
   type a new value, press Enter again.
2. Navigate to another editable cell, press Enter, type a value, press Esc.
3. Navigate to an editable cell, press Enter to start editing, then press Tab.
4. Repeat step 3 targeting a cell using a popup editor (Mantine-backed).

**Expected:**
- Step 1: the edit commits (`dataSource.applyChanges` called) and focus moves down one row
  (`enterNavigatesVerticallyAfterEdit`).
- Step 2: the cell reverts to its pre-edit value; no `applyChanges` call for that cell.
- Step 3: the edit commits and focus moves right to the next editable cell.
- Step 4: same as step 3, but through a popup editor — the popup closes and focus returns to the grid moving
  right, without getting stuck inside the popup (ties into scenario 7).

**Covered by:** `packages/ag-grid/test/a11y/announcements.test.tsx` (real grid in jsdom via `fireEvent`): Enter commits and focus moves down one row, Esc restores the value with no `applyChanges`, Tab commits and moves to the next EDITABLE cell (skipping a formula and a read-only column). Its `it.todo("Tab across a popup editor (longText / multiSelect) keeps focus in the grid")` points here (step 4).

---

## 16. Live-region output

**Preconditions:** any of the above stories; a Playwright accessibility snapshot or an `aria-live` text
assertion on `.sg-root`'s live region element.

**Steps:**
1. Commit a normal cell edit; read the live region text immediately after.
2. Trigger a conflict (scenario 9); read the live region text.
3. Perform a paste with some skipped/errored cells (scenario 6); read the live region text.
4. Trigger an edit that gets rejected (e.g. permission or validation failure) and read the live region text.

**Expected:**
- Step 1: the polite region announces "Saved" (one cell) / "Saved N cells".
- Step 2: the assertive region announces "Conflict on {column}, row {id}" ("Conflicts on N cells" for several).
- Step 3: the polite region announces "Paste: N pasted, M skipped, K errors" (+ ", C conflicts"); nothing
  assertive for a paste.
- Step 4: the assertive region announces "Edit rejected on {column}: {reason}" for a server-rejected cell,
  or "Edit cancelled" for a `beforeCellsChange` veto.
- Assert on the region's `aria-live` value (`polite` / `assertive`) as well as its text, and that a screen
  reader (e.g. VoiceOver / NVDA via an accessibility snapshot) actually speaks each message once, including an
  identical message repeated twice in a row (the announcer toggles a zero-width marker to force re-reading).

**Covered by:** `packages/ag-grid/test/a11y/announcements.test.tsx` (wording builders; polite "Saved", assertive "Conflict on Name, row r1", "Edit rejected on Name: Too long", "Edit cancelled", polite paste summary) and `packages/ag-grid/test/grid/SchemaGrid.test.tsx` (`createAnnouncer`, `<LiveAnnouncer>` regions and `aria-live` attributes). Its `it.todo("screen-reader output sanity for Saved / Conflict / Paste announcements")` points here.

---

## `it.todo` index

Every jsdom test that defers to a real browser, and the scenario it points at:

| Test file (under `packages/ag-grid/test/`) | `it.todo` | Scenario |
|---|---|---|
| `range/useRangeSelection.test.tsx` | real mouse drag across cells and edge autoscroll | 1 |
| `fill/useFillHandle.test.tsx` | real drag of the fill handle, including fills that cross virtualised rows | 3, 4 |
| `clipboard/useClipboard.test.tsx` | real OS clipboard round-trip with Sheets-formatted text | 5 |
| `editors/editors.test.tsx` | focus stays inside real popup editors while tabbing/clicking | 7 |
| `a11y/announcements.test.tsx` | Tab across a popup editor (longText / multiSelect) keeps focus in the grid | 15 (step 4), 7 |
| `a11y/announcements.test.tsx` | screen-reader output sanity for Saved / Conflict / Paste announcements | 16 |
