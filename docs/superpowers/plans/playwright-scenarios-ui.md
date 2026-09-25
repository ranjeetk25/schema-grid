# ui-mantine: Playwright scenarios (apps/storybook)

Behaviour jsdom cannot prove for `@ranjeetk25/schema-grid-ui-mantine`. Run each in
Storybook against a real AG Grid (Community ^36) and, where noted, demo-api.
Implemented in `apps/storybook/e2e` (`bun run e2e`); each item says which spec
covers it, or why it is not implemented.

1. **Popup editors commit inside a real grid** — select, multiSelect,
   creatableSelect, date, datetime (including the time dropdown), user and link.
   Clicking a dropdown option commits that value; the edit is not stopped early
   by AG Grid's focus-loss / outside-click detection.
   **Implemented:** `editors-keyboard.spec.ts` (select, multiSelect,
   creatableSelect), `field-types.spec.ts` (date, link),
   `filter-views-columns.spec.ts` (new select column). **Not implemented:**
   datetime time dropdown and user picker.
2. **Keyboard in popup editors** — Enter commits, Escape cancels, Tab moves to
   the next cell, arrow keys move through options without the grid moving the
   cell focus.
   **Implemented:** `editors-keyboard.spec.ts`. (Found two bugs: Select /
   MultiSelect never focused their input, and Enter committed the old value
   instead of the highlighted option.)
3. **Edge placement** — popup editors opened in the right-most column and the
   bottom row are not clipped, and reposition correctly after horizontal
   scroll.
   **Not implemented:** clipping is visual; needs screenshot baselines.
4. **FilterButton popover** — nested Select, MultiSelect and relative-date
   dropdowns do not close the popover. §8 end to end with demo-api: "payment
   status is not Paid AND call status is within yesterday" (Asia/Kolkata)
   returns rows with empty payment status; save as a view; reload it the next
   day and it still means "yesterday".
   **Implemented:** `filter-views-columns.spec.ts` (client, browser clock
   pinned) and `server-demo-api.spec.ts` (demo-api + MySQL, view persisted in
   localStorage and reopened with the API clock +24h).
5. **Formula autocomplete** — caret lands after the inserted `{key}` in a
   multi-line textarea; IME composition does not trigger or corrupt insertion.
   **Not implemented:** no formula-column story yet, and IME composition
   cannot be driven faithfully from Playwright/Chromium.
6. **Column builder modal** — focus trap, Stepper keyboard navigation, colour
   swatch popover inside the modal; creating a select column shows the new
   column in the grid.
   **Implemented (create + edit the new column):** `filter-views-columns.spec.ts`.
   **Not implemented:** focus-trap / Stepper keyboard / swatch assertions.
7. **Import wizard** — real CSV and XLSX via the native FileButton picker,
   a large-file job whose progress is polled, and the error report download.
   **Implemented (CSV via the native file chooser, auto-map, preview counts,
   create):** `permissions-import-export.spec.ts`. **Not implemented:** XLSX
   upload, the polled server job and the error-report download (the story
   imports in the browser; demo-api's `/import` job is covered by its HTTP
   tests).
8. **Export dialog** — downloads a real CSV and XLSX of the current view with
   only visible, readable columns.
   **Implemented:** `permissions-import-export.spec.ts` (CSV + XLSX).
9. **Conflict popover** — stays anchored to its cell during grid scroll and
   virtualised row recycling; Keep theirs / Overwrite reach the ag-grid
   resolution callback.
   **Implemented (anchoring + both resolutions):** `conflict-polling.spec.ts`,
   `server-demo-api.spec.ts`. **Not implemented:** anchoring during scroll /
   row recycling. Note: the dropdown's `aria-label` is overridden by Mantine's
   `aria-labelledby` (the empty anchor), so it has no accessible name.
10. **Theme** — toggling Mantine dark mode repaints the grid live via
    `useGridThemeFromMantine` / `mantineGridCssVariablesResolver`.
    **Not implemented:** no colour-scheme toggle in the stories yet.
11. **Notifications** — the paste-report toast appears when `<Notifications />`
    is mounted; nothing breaks when `@mantine/notifications` is absent.
    **Implemented (toast shown):** `range-clipboard.spec.ts`. Needs
    `notifyClipboardReport(report, { loader: () => import("@mantine/notifications") })`:
    the default loader's non-static `import()` can't resolve in a bundled app
    and always returns "unavailable".
12. **Date editors in grid mode** — Mantine's date pickers cannot be opened
    programmatically on mount; confirm focus-then-open UX is acceptable (or
    switch to a custom Popover wrapper).
    **Implemented:** `field-types.spec.ts` — the picker trigger is focused on
    open, one click opens the calendar, picking a day commits.
