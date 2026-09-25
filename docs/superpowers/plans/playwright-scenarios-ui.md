# ui-mantine: Playwright scenarios (apps/storybook)

Behaviour jsdom cannot prove for `@masai/schema-grid-ui-mantine`. Run each in
Storybook against a real AG Grid (Community ^36) and, where noted, demo-api.
Design-only: scenario + acceptance criteria.

1. **Popup editors commit inside a real grid** — select, multiSelect,
   creatableSelect, date, datetime (including the time dropdown), user and link.
   Clicking a dropdown option commits that value; the edit is not stopped early
   by AG Grid's focus-loss / outside-click detection.
2. **Keyboard in popup editors** — Enter commits, Escape cancels, Tab moves to
   the next cell, arrow keys move through options without the grid moving the
   cell focus.
3. **Edge placement** — popup editors opened in the right-most column and the
   bottom row are not clipped, and reposition correctly after horizontal
   scroll.
4. **FilterButton popover** — nested Select, MultiSelect and relative-date
   dropdowns do not close the popover. §8 end to end with demo-api: "payment
   status is not Paid AND call status is within yesterday" (Asia/Kolkata)
   returns rows with empty payment status; save as a view; reload it the next
   day and it still means "yesterday".
5. **Formula autocomplete** — caret lands after the inserted `{key}` in a
   multi-line textarea; IME composition does not trigger or corrupt insertion.
6. **Column builder modal** — focus trap, Stepper keyboard navigation, colour
   swatch popover inside the modal; creating a select column shows the new
   column in the grid.
7. **Import wizard** — real CSV and XLSX via the native FileButton picker,
   a large-file job whose progress is polled, and the error report download.
8. **Export dialog** — downloads a real CSV and XLSX of the current view with
   only visible, readable columns.
9. **Conflict popover** — stays anchored to its cell during grid scroll and
   virtualised row recycling; Keep theirs / Overwrite reach the ag-grid
   resolution callback.
10. **Theme** — toggling Mantine dark mode repaints the grid live via
    `useGridThemeFromMantine` / `mantineGridCssVariablesResolver`.
11. **Notifications** — the paste-report toast appears when `<Notifications />`
    is mounted; nothing breaks when `@mantine/notifications` is absent.
12. **Date editors in grid mode** — Mantine's date pickers cannot be opened
    programmatically on mount; confirm focus-then-open UX is acceptable (or
    switch to a custom Popover wrapper).
