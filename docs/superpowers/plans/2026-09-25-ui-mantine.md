# @masai/schema-grid-ui-mantine Implementation Plan

> **REQUIRED SUB-SKILL:** superpowers:subagent-driven-development

**Goal:** Build `@masai/schema-grid-ui-mantine`: Mantine v8 editor and renderer widgets registered through `createMantineUiRegistry()`, a filter builder with chips and a button, a column builder modal with a Zod-driven auto-form and formula editor, a view switcher, a group-by bar, a conflict prompt, an import wizard, an export dialog, a clipboard-report toast and a theme bridge. Each area ships as its own subpath export.

**Architecture:** The package holds only UI. All logic comes from `@masai/schema-grid-core`: field types, operators, `validateFilter`, the formula parser, `format`, and the permission types. Grid integration goes through `@masai/schema-grid-ag-grid`: `UiFieldTypeRegistry`, `createPopupEditor`, and the clipboard/conflict types. File parsing and mapping go through `@masai/schema-grid-io`. Two small adapter files (`src/internal/grid-contracts.ts`, `src/internal/io-contracts.ts`) are the only places that import from ag-grid or io. If an export is missing at implementation time, the adapter defines a local type alias or a minimal fallback with a `TODO(spec §4.x)` comment. It does not block. **Dependency direction: ui-mantine depends on ag-grid; ag-grid must never import ui-mantine.**

Stateful widgets are split into a pure model (reducer or helper functions, unit-tested without DOM) and thin Mantine components (tested with Testing Library). All popup editors keep their dropdown DOM inside the editor, using `withinPortal={false}` or `comboboxProps={{ withinPortal:false }}`, and are wrapped with `createPopupEditor`.

The reason is AG Grid's own behaviour. A Mantine portal renders into `document.body`, outside the grid cell. A click there counts as focus leaving the grid (`stopEditingWhenCellsLoseFocus` and AG Grid's outside-click detection), so AG Grid ends the edit and unmounts the editor before the option click registers. The value is lost or the wrong one is committed. `createPopupEditor` puts the editor in AG Grid's popup layer, so the in-editor dropdown is not clipped by the cell's `overflow:hidden`.

**Tech Stack:** TypeScript strict, React 18, Mantine v8 (`@mantine/core`, `@mantine/hooks`, `@mantine/dates` with string date values), dayjs, Zod (`^3.25 || ^4`), tsup (ESM+CJS), Vitest 3 + @testing-library/react 16 + @testing-library/user-event + jsdom, Biome, bun 1.2.4 workspaces. `@mantine/notifications` is an optional peer.

**Mantine v8 facts (verified):** `@mantine/dates` v8 uses **string values** (`YYYY-MM-DD`, `YYYY-MM-DD HH:mm:ss`), not `Date`. `DateTimePicker` needs `popoverProps` and `timePickerProps.popoverProps` set to `{ withinPortal: false }`. Select/MultiSelect/TagsInput take `comboboxProps={{ withinPortal:false }}`; Combobox/Popover/Menu take `withinPortal`. Creatable pattern = Combobox + `useCombobox` with a `$create` sentinel. `MantineProvider env="test"` turns off portals and transitions. Vitest setup must mock `matchMedia`, `ResizeObserver`, `scrollIntoView`, `getComputedStyle`. `cssVariablesResolver` exists on the provider. `FileButton` has `accept` and `resetRef`.

**Commands (run after every task):** `bun run --filter @masai/schema-grid-ui-mantine test` and `bun run --filter @masai/schema-grid-ui-mantine typecheck`. Never run `check:fix` or `format` automatically.

**Rules for every task:** Write the failing test first, run it and see it fail, write the minimum implementation, run test and typecheck and see them pass, then commit. No `any` in public types. Row generic is `<Row extends GridRow>`. Double quotes. Commit messages must end with the repo's attribution trailer.

**Zod 3 vs 4:** peer is `^3.25 || ^4`; ZodForm's introspection must handle both internal shapes (`_def.typeName` in v3, `_zod.def.type` in v4) — Task 17.

---

## File structure

Everything lives under `packages/ui-mantine/`.

- `package.json`: name `@masai/schema-grid-ui-mantine`.
  - Exports: `.`, `./editors`, `./filter-builder`, `./column-builder`, `./import-export`, each with a `development` condition pointing at `src`.
  - Dependencies: core, ag-grid and io as `workspace:*`.
  - Peers: react ^18, react-dom ^18, @mantine/core ^8, @mantine/hooks ^8, @mantine/dates ^8, dayjs, zod `^3.25 || ^4`, and optional @mantine/notifications ^8 (`peerDependenciesMeta`).
  - devDeps: the same libraries plus ag-grid-community ^36, ag-grid-react ^36, @testing-library/user-event.
- `tsconfig.json`, `tsup.config.ts` (one entry per subpath; peers and the notifications package marked external), `vitest.config.ts` (jsdom, setup file), `vitest.setup.ts` (jest-dom, plus mocks for matchMedia, ResizeObserver, scrollIntoView and getComputedStyle).
- `README.md`: usage, the popup-editor/portal explanation, the optional-notifications note.
- `src/index.ts`: root barrel (views, conflict, theming, notifications, and re-exports of the subpath barrels).
- `src/internal/grid-contracts.ts`: ag-grid adapter (`UiFieldTypeRegistry`, `UiEditorProps`, `UiRendererProps`, `UiFilterInputProps`, `createPopupEditor`, `ClipboardReport`, `ConflictResolution`).
- `src/internal/io-contracts.ts`: io adapter (`parseFile`, `autoMapColumns`, `validateRows`, `buildExport`, `ParsedFile`, `ColumnMapping`, `RowValidationResult`, `ImportJobStatus`).
- `src/internal/options.ts`: option and colour helpers.
- `src/internal/relative-time.ts`: wrapper around `Intl.RelativeTimeFormat`, so no global dayjs plugin is needed.
- `src/test/render.tsx`: `renderWithMantine(ui, { env })`, with env defaulting to `"test"`.
- `src/test/fixtures.ts`:
  - `buildFixtureSchema()` with columns: payment status (select: Paid, Pending, Failed, with colours), call status (date), amount (currency), notes (longText), owner (user), website (url), secret (text, hidden by access), total (formula)
  - `buildFixtureAccess()`
  - a stub `DataSource`
  - `buildStubUiRegistry()`
- `src/editors/`: `TextEditor.tsx`, `LongTextEditor.tsx`, `ContactEditors.tsx` (url/email/phone), `NumberEditor.tsx`, `CurrencyEditor.tsx`, `BooleanEditor.tsx`, `DateEditors.tsx`, `SelectEditor.tsx`, `MultiSelectEditor.tsx`, `CreatableSelectEditor.tsx`, `AsyncCombobox.tsx`, `UserPickerEditor.tsx`, `LinkPickerEditor.tsx`, `index.ts`, plus colocated `*.test.tsx`.
- `src/renderers/`: `OptionBadge.tsx`, `SelectRenderer.tsx`, `MultiSelectRenderer.tsx`, `UserRenderer.tsx`, `UrlRenderer.tsx`, `FormattedRenderer.tsx`, `FormulaRenderer.tsx`, `index.ts`, plus tests.
- `src/registry/createMantineUiRegistry.ts` plus test.
- `src/filter-builder/`: `model.ts`, `describeFilter.ts`, `FilterValueInput.tsx`, `FilterConditionRow.tsx`, `FilterGroupEditor.tsx`, `FilterBuilder.tsx`, `FilterChips.tsx`, `FilterButton.tsx`, `index.ts`, plus tests.
- `src/column-builder/`:
  - `zod-form/introspect.ts`, `zod-form/ZodForm.tsx`, `zod-form/OptionListField.tsx`, `zod-form/JsonFallbackField.tsx`
  - `keys.ts`, `model.ts`, `TypeStep.tsx`, `ConfigStep.tsx`, `CommonFields.tsx`, `FormulaEditor.tsx`, `PermissionsStep.tsx`, `PreviewStep.tsx`, `ColumnBuilderModal.tsx`, `index.ts`, plus tests
- `src/views/`: `ViewSwitcher.tsx`, `GroupByBar.tsx`, plus tests.
- `src/conflict/`: `ConflictPopover.tsx`, `RemoteChangedBadge.tsx`, plus tests.
- `src/import-export/`: `import-model.ts`, `ImportWizard.tsx`, `steps/UploadStep.tsx`, `steps/MapStep.tsx`, `steps/PreviewStep.tsx`, `steps/RunStep.tsx`, `ExportDialog.tsx`, `index.ts`, plus tests.
- `src/notifications/notifyClipboardReport.ts` plus test.
- `src/theme/useGridThemeFromMantine.ts` plus test.
- `src/exports.test.ts`: subpath smoke test.
- Repo-level: `docs/superpowers/plans/playwright-scenarios-ui.md` and `.changeset/ui-mantine-initial.md`.

---

## Dependency graph

```
T1 ─► T2 ─► T3 ─┬─► [A] T4 T5 T6 T7 T8 T9 T10 T11  (editors/renderers, parallel)
                │         └────────────► T12 (registry; needs T4–T11)
                ├─► [B] T13 ─► T14 ─► T15 ─► T16             (filter builder, serial)
                ├─► [C] T17 ─► T18 ┐
                │       T19 ───────┤
                │       T20 ───────┼─► T22 (modal)
                │       T21 ───────┘   (T17/T19/T20/T21 parallel)
                ├─► [D] T23, T24, T25, T28 (parallel, independent)
                └─► [E] T26 ─► T27                          (import wizard)
T1 ─► [F] T29, T30 (parallel, independent of T2/T3)
ALL ─► T31 (exports, build, Playwright doc, changeset)
```

- Lanes A–F can run in parallel once T3 is merged. T29 and T30 only need T1.
- Tasks within a lane that are listed with commas are parallel. Arrows mean serial.
- Tasks in different lanes that touch the same barrel (`index.ts`) should append only. Resolve barrel conflicts at merge.

---

### Task 1: Package scaffold and test harness
**Goal:** An empty but green package with a working Mantine test wrapper.

**Files:**
- `packages/ui-mantine/package.json`, `tsconfig.json` (extends `../../tsconfig.base.json`, includes `src`), `tsup.config.ts`, `vitest.config.ts`, `vitest.setup.ts`
- `src/index.ts`, plus empty barrels `src/editors/index.ts`, `src/filter-builder/index.ts`, `src/column-builder/index.ts`, `src/import-export/index.ts`
- `src/test/render.tsx`

**API:**
- `renderWithMantine(ui, options?)` wraps the UI in `MantineProvider` (with `DatesProvider` from `@mantine/dates`). `options.env` defaults to `"test"`, which disables portals and transitions. Portal-sensitive tests pass `"default"`.
- Also re-exports `userEvent` setup.

**Test:** `src/test/render.test.tsx`
- Renders a Mantine `Button` and finds it by role.
- `useMantineTheme()` inside the wrapper returns a theme with `primaryColor`.
- With `env: "default"`, a `Popover` with `withinPortal` renders its dropdown outside the container. This proves the harness can detect portals, which later tasks rely on.

**Commit:** `chore(ui-mantine): scaffold package, vitest jsdom harness, Mantine test wrapper`

### Task 2: Contract adapters for ag-grid and io
**Goal:** Put every cross-package import behind one adapter file per package, so missing upstream exports never block work.

**Files:**
- `src/internal/grid-contracts.ts`, `src/internal/io-contracts.ts`
- Tests: `src/internal/grid-contracts.test.ts`, `src/internal/io-contracts.test.ts`

**API, grid-contracts:**
- Re-exports `UiFieldTypeRegistry`, `createPopupEditor`, `ClipboardReport`, `ConflictResolution` from `@masai/schema-grid-ag-grid`.
- Defines the editor, renderer and filter-input prop types used by this package.
- `UiEditorProps<TValue, TConfig>`: `value`, `onChange`, `onCommit`, `onCancel`, `column: ColumnDef`, `config: TConfig`, `dataSource?`, `autoFocus?`, `error?`, `onOptionCreate?`.
- `UiRendererProps<TValue, TConfig>`: `value`, `column`, `config`, `row?`, `fieldType`.
- `UiFilterInputProps`: `column`, `operator: FilterOperatorDef`, `value`, `onChange`, `dataSource?`.
- If ag-grid lacks any of these, define a local alias. The local `UiFieldTypeRegistry` shape is `register(id, { renderer?, editor?, filterComponent? })`, `get`, `has`, `list`. The local `createPopupEditor` fallback returns the component tagged with a static `isPopup` marker. Each fallback carries `// TODO(spec §4.2 / ag-grid plan): import from @masai/schema-grid-ag-grid`.

**API, io-contracts:**
- Same pattern for `parseFile`, `autoMapColumns`, `validateRows`, `buildExport` and their result types.
- Also defines `ImportJobStatus` (`state: "queued"|"running"|"done"|"failed"`, `processed`, `total`, `errorCount`, `errorReportUrl?`) and `ImportMode` (`"create"|"update"|"upsert"`) if io doesn't export them.
- Fallback functions throw a clear "io not available" error. Tests inject implementations through props anyway.

**Tests:**
- `createPopupEditor(Component)` returns something renderable that renders the wrapped component.
- The registry from the adapter supports register, get and has for a dummy id.
- The io adapter exposes all four function names as functions.

**Commit:** `feat(ui-mantine): add grid and io contract adapters with spec-referenced fallbacks`

### Task 3: Fixtures and option helpers
**Goal:** Shared test fixtures and the helpers that turn options into colours.

**Files:**
- `src/test/fixtures.ts`, `src/internal/options.ts`, `src/internal/relative-time.ts`
- Tests: `src/internal/options.test.ts`, `src/internal/relative-time.test.ts`

**API:**
- `buildFixtureSchema()`: a `GridSchema` with the columns listed under File structure, built on core's `createDefaultRegistry()`.
- `buildFixtureAccess()`: `Map<columnId, Access>` with `secret` set to `"hidden"`.
- `buildStubDataSource()`: `getOptions`, `createOption` and `lookup` as `vi.fn`-friendly stubs.
- `buildStubUiRegistry()`.
- `getSelectOptions(config)`: reads a `{label, value, color}[]` list from a select config.
- `resolveOptionColor(option, theme)`: named Mantine colour, a CSS colour, or the default `"gray"`.
- `formatRelativeTime(from, now, locale?)`: uses `Intl.RelativeTimeFormat` with the unit chosen automatically.

**Tests:**
- Fixture schema passes the core schema validation (if core exposes it), and every column type exists in the default registry.
- `resolveOptionColor` returns the configured colour and falls back to gray.
- `formatRelativeTime` gives "5 minutes ago" for a 5-minute difference, and "yesterday" or "1 day ago" for 24 hours.

**Commit:** `test(ui-mantine): add fixture schema, option color and relative time helpers`

### Task 4: Text-family editors
**Goal:** Editors for text, longText (popup), and url/email/phone.

**Files:**
- `src/editors/TextEditor.tsx`, `LongTextEditor.tsx`, `ContactEditors.tsx`
- Tests: `src/editors/text-editors.test.tsx`

**API:**
- `TextEditor`: `TextInput`. Enter calls `onCommit`, Escape calls `onCancel`.
- `LongTextEditor`: `Textarea` with `autosize`. Wrapped export `LongTextPopupEditor = createPopupEditor(LongTextEditor)`. Cmd/Ctrl+Enter commits. A plain Enter inserts a newline.
- `UrlEditor`, `EmailEditor`, `PhoneEditor`: `TextInput` with `type` and `inputMode` set to url, email and tel. Each shows a non-blocking `description`/`error` hint when core's `parse(input, config)` fails. Commit is still allowed; the core validation layer decides.

**Tests:**
- Typing then Enter calls `onCommit` with the typed string. Escape calls `onCancel`.
- In LongText, Enter adds a newline and Ctrl+Enter commits.
- The Email editor has `inputmode="email"` and shows the hint for `"abc"` but not for `"a@b.co"`.
- The Phone editor has `inputmode="tel"`. The Url editor has `inputmode="url"`.

**Commit:** `feat(ui-mantine): text, long text popup, url/email/phone editors`

### Task 5: Number, currency and boolean editors
**Files:**
- `src/editors/NumberEditor.tsx`, `CurrencyEditor.tsx`, `BooleanEditor.tsx`
- Tests: `src/editors/number-editors.test.tsx`

**API:**
- `NumberEditor`: `NumberInput` that respects the config's precision, min and max. `onChange` emits `number | null`; an empty input gives null.
- `CurrencyEditor`: `NumberInput` with `prefix` set to the config's currency symbol, `thousandSeparator` (with `thousandsGroupStyle: "lakh"` when the config locale is `en-IN`), and `decimalScale` / `fixedDecimalScale` from the config.
- `BooleanEditor`: `Checkbox`. Space toggles and commits immediately.

**Tests:**
- Typing `1234.5` emits the number 1234.5.
- Clearing emits null.
- The currency editor shows `₹1,23,456` for the INR/lakh config and `$123,456` for USD.
- Clicking the checkbox calls `onChange(true)` and then `onCommit`.

**Commit:** `feat(ui-mantine): number, currency and checkbox editors`

### Task 6: Date and datetime popup editors
**Files:**
- `src/editors/DateEditors.tsx`
- Tests: `src/editors/date-editors.test.tsx`

**API:**
- `DateEditor`: `DatePickerInput` with `popoverProps={{ withinPortal:false }}`. Exported wrapped as `DatePopupEditor`.
- `DateTimeEditor`: `DateTimePicker` with `popoverProps={{ withinPortal:false }}` and `timePickerProps.popoverProps={{ withinPortal:false }}`. Exported wrapped as `DateTimePopupEditor`.
- Values follow Mantine v8's string format (`YYYY-MM-DD`, `YYYY-MM-DD HH:mm:ss`). The editor converts to and from the core storage form through the field type's `parse` and `serialize`, using dayjs.

**Tests:**
- With `env: "default"` (portals enabled), opening the picker renders the calendar **inside** the render container. This is the portal guarantee.
- Picking day 15 emits the matching core date value.
- The datetime editor emits a value that includes the time.
- Escape calls `onCancel` without emitting a change.

**Commit:** `feat(ui-mantine): date and datetime popup editors rendered without portal`

### Task 7: Select and MultiSelect popup editors
**Files:**
- `src/editors/SelectEditor.tsx`, `MultiSelectEditor.tsx`
- Tests: `src/editors/select-editors.test.tsx`

**API:**
- `SelectEditor`: `Select` with `searchable`, `comboboxProps={{ withinPortal:false }}` and `defaultDropdownOpened`. Options come from the config (or `dataSource.getOptions` when the config says it is dynamic). Each option shows a colour dot through `renderOption`. Selecting commits. Wrapped as `SelectPopupEditor`.
- `MultiSelectEditor`: the same, but with `MultiSelect`. It commits on Enter or blur rather than on each pick. Wrapped as `MultiSelectPopupEditor`.

**Tests:**
- The dropdown is inside the container with portals enabled.
- Typing `pai` filters the list to `Paid`.
- Selecting `Paid` calls `onChange("paid")` and `onCommit`.
- The multi editor adds two values, and Enter commits an array of two.
- Colour dots use the configured colours.

**Commit:** `feat(ui-mantine): searchable select and multiselect popup editors`

### Task 8: Creatable select editor
**Files:**
- `src/editors/CreatableSelectEditor.tsx`
- Tests: `src/editors/creatable-select.test.tsx`

**API:**
- `CreatableSelectEditor` is built from `Combobox`, `useCombobox` and `InputBase`, with `withinPortal={false}`.
- When the search has no exact match (case-insensitive), a trailing `Create '<x>'` option appears. Its sentinel value is `$create`.
- Submitting it calls `dataSource.createOption(column.id, label)`. While that runs, a loader shows and the input is disabled.
- On success it emits `onOptionCreate(option)` and `onChange(option.value)`, then commits.
- On failure it shows an inline error and stays open.
- Wrapped as `CreatableSelectPopupEditor`.

**Tests:**
- Typing an existing label shows no create option.
- Typing `Refunded` shows `Create 'Refunded'`. Clicking it calls `createOption` with `(columnId, "Refunded")`, then `onOptionCreate` with the returned option, then `onChange` with its value.
- A rejected `createOption` shows the error text and does not call `onCommit`.

**Commit:** `feat(ui-mantine): creatable select editor wired to dataSource.createOption`

### Task 9: Async combobox and user picker
**Files:**
- `src/editors/AsyncCombobox.tsx`, `UserPickerEditor.tsx`
- Tests: `src/editors/user-picker.test.tsx`

**API:**
- `AsyncCombobox<TItem>`: internal and reusable.
  - Props: `load(search): Promise<TItem[]>`, `getKey`, `getLabel`, `renderItem`, `value`, `onSelect`, `debounceMs` (default 250, via `useDebouncedValue`).
  - Uses `withinPortal={false}` and shows loading, empty and error states.
  - Stale responses are dropped using a request id.
- `UserPickerEditor`: calls `dataSource.getOptions(column.id, search)`. Each item shows an `Avatar` (image or initials) and the name. Wrapped as `UserPickerPopupEditor`.

**Tests:**
- Opening calls `getOptions` once with an empty search.
- Typing debounces to a single call (use fake timers).
- Results show the avatar and name. Selecting emits the user id and commits.
- A slower earlier response arriving after a later one does not overwrite the results.

**Commit:** `feat(ui-mantine): async combobox primitive and user picker editor`

### Task 10: Link-to-record picker
**Files:**
- `src/editors/LinkPickerEditor.tsx`
- Test: `src/editors/link-picker.test.tsx`

**API:**
- `LinkPickerEditor` uses `AsyncCombobox` with `dataSource.lookup(column.id, search)` returning `LinkRef[]`. It emits a `LinkRef`, or an array if the config allows many.
- It shows "Lookup not configured" and stays read-only when `dataSource.lookup` is absent.
- Wrapped as `LinkPickerPopupEditor`.

**Tests:**
- Calls `lookup` with the typed search.
- Selecting emits the LinkRef.
- Without `lookup`, it shows the notice and does not throw.

**Commit:** `feat(ui-mantine): link-to-record async picker editor`

### Task 11: Renderers
**Files:**
- `src/renderers/*.tsx`, `src/renderers/index.ts`
- Test: `src/renderers/renderers.test.tsx`

**API:**
- `OptionBadge`: `Badge` with its colour from `resolveOptionColor`.
- `SelectRenderer`: an `OptionBadge`, or nothing for empty.
- `MultiSelectRenderer`: a `Pill.Group` of coloured `Pill`s, with an overflow "+N".
- `UserRenderer`: `Avatar` plus name.
- `UrlRenderer`: an `Anchor` with `target="_blank"` and `rel="noopener noreferrer"`. It links only for http(s) and shows plain text otherwise.
- `FormattedRenderer`: text from the field type's `format(value, config)`. Used for number, currency, date, datetime, text, email and phone.
- `FormulaRenderer`: read-only, formatted by the inferred result type. Shows a muted error marker when the value is a formula error.

**Tests:**
- A `Paid` badge has the green colour variable.
- Multi with 5 values and a limit of 3 shows "+2".
- The user renderer shows initials when there is no image.
- `javascript:` URLs are rendered as text, not a link.
- The currency renderer's text equals the core `format` output.
- The formula renderer never renders an input.

**Commit:** `feat(ui-mantine): badge/pill/avatar/link/formatted/formula renderers`

### Task 12: createMantineUiRegistry
**Files:**
- `src/registry/createMantineUiRegistry.ts`, `src/editors/index.ts`
- Test: `src/registry/createMantineUiRegistry.test.ts`

**API:**
- `createMantineUiRegistry(options?)` returns `UiFieldTypeRegistry`. It registers a renderer, an editor and a `filterComponent` for all 16 built-in `FieldTypeId`s.
- Popup types (longText, date, datetime, select, multiSelect, creatableSelect, user, link) register their `createPopupEditor`-wrapped editor.
- Formula registers a renderer only, with no editor.
- `filterComponent` is the inline value-input variant of each editor (no commit or cancel semantics).
- `options.overrides` lets callers replace entries per type.
- The editors barrel exports every editor, renderer and the registry factory.
- The README gets a "Why popup editors skip the portal" section.

**Tests:**
- Every id from the core default registry's `list()` has a renderer.
- Every id except formula has an editor. Formula's editor is undefined.
- The popup set carries the popup marker and the inline set does not.
- An override replaces the select renderer.

**Commit:** `feat(ui-mantine): createMantineUiRegistry registering all built-in field types`

### Task 13: Filter builder model (pure)
**Files:**
- `src/filter-builder/model.ts`
- Test: `src/filter-builder/model.test.ts`

**API:**
- `FilterDraft`: a group or condition tree with stable client ids.
- `toDraft(node | null)` and `fromDraft(draft)` convert to and from core `FilterNode`. The root is always a group.
- `addCondition(draft, groupId)`, `addGroup(draft, groupId)` (refused past `maxDepth`), `removeNode`, `updateCondition`, `setGroupOp`.
- `filterableColumns(schema, access)`: excludes hidden columns.
- `operatorsFor(column, registry)`: for formula columns, uses the operators of the inferred result type.
- `defaultValueFor(valueKind)`: none gives undefined, multi gives `[]`, range gives `{from:null,to:null}`, relativeDate gives `{relative:"today"}`, me gives `{me:true}`.
- `canAddGroup(draft, groupId, maxDepth)`.
- When the column changes, the operator resets to the first valid one and the value resets.

**Tests:**
- Round trip `toDraft` then `fromDraft` keeps the AST.
- `filterableColumns` omits `secret`.
- Operators for a select column are exactly `is, isNot, isAnyOf, isNoneOf, isEmpty, isNotEmpty`. For a date column they include `isWithin`.
- `canAddGroup` is false on a group at depth 2.
- Changing a condition's column from select to date resets the operator to a date operator.

**Commit:** `feat(ui-mantine): pure filter draft model with depth and hidden-column rules`

### Task 14: FilterValueInput by valueKind
**Files:**
- `src/filter-builder/FilterValueInput.tsx`
- Test: `src/filter-builder/FilterValueInput.test.tsx`

**API:**
- `FilterValueInput` props: `column`, `operator`, `value`, `onChange`, `registry`, `dataSource?`.
- Chooses the input by `operator.valueKind`:
  - `none`: renders nothing
  - `single`: the registry's `filterComponent` for the column type, falling back to `TextInput`
  - `multi`: `MultiSelect` for option types, `TagsInput` otherwise
  - `range`: two inputs, from and to
  - `relativeDate`: a preset `Select` (today, yesterday, tomorrow, thisWeek, lastWeek, thisMonth, lastMonth, lastNDays, nextNDays) plus a `NumberInput` for N, shown only for lastNDays/nextNDays
  - `me`: a static "Current user" label
- All dropdowns use `withinPortal:false`, because the builder lives inside a Popover.

**Tests:**
- `isEmpty` renders no input.
- `isWithin` renders the preset select. Choosing "yesterday" emits `{relative:"yesterday"}`. Choosing "lastNDays" shows N, and typing 7 emits `{relative:"lastNDays", n:7}`.
- `between` renders two inputs and emits `{from,to}`.
- `isAnyOf` on select renders a multi select.
- `isMe` shows the label and emits `{me:true}`.

**Commit:** `feat(ui-mantine): filter value input switching on operator valueKind`

### Task 15: FilterBuilder component
**Files:**
- `src/filter-builder/FilterConditionRow.tsx`, `FilterGroupEditor.tsx`, `FilterBuilder.tsx`
- Test: `src/filter-builder/FilterBuilder.test.tsx`

**API:**
- `FilterBuilder` props: `schema`, `registry` (core `FieldTypeRegistry`), `uiRegistry`, `access`, `value: FilterNode | null`, `onChange(node | null)`, `maxDepth` (default 2), `dataSource?`.
- Each row is: column `Select` (filterable columns only), operator `Select` (from `operatorsFor`), `FilterValueInput`, and a remove `ActionIcon`.
- Each group has an AND/OR `SegmentedControl`, "Add condition", and "Add group" (disabled when `canAddGroup` is false, with a tooltip explaining why).
- On every change it runs core `validateFilter(node, schema, registry, readableColumnIds)`. Errors map to inline `error` props on the matching row or field.
- It emits `onChange` with `fromDraft`. An empty root emits null.
- Also exports `useFilterDraft`.

**Tests:**
- **§8 scenario:** pick "payment status", "is not", "Paid"; add a condition "call status", "is within", "yesterday"; the root op stays AND. `onChange` receives exactly `{op:"and", children:[{columnId:<payment>, operator:"isNot", value:"paid"}, {columnId:<call>, operator:"isWithin", value:{relative:"yesterday"}}]}`.
- The operator options change when the column changes from select to date.
- In a nested group, "Add group" is disabled.
- The column options do not include `secret`.
- A condition with an empty single value shows the validation error inline.
- Toggling to OR updates the emitted `op`.
- Remove deletes the row.

**Commit:** `feat(ui-mantine): FilterBuilder with AND/OR groups, depth limit and inline validation`

### Task 16: FilterChips and FilterButton
**Files:**
- `src/filter-builder/describeFilter.ts`, `FilterChips.tsx`, `FilterButton.tsx`, `index.ts`
- Test: `src/filter-builder/FilterChips.test.tsx`

**API:**
- `describeCondition(cond, schema, registry)`: returns a label such as "Payment status is not Paid", with values formatted by the field type's `format` and relative presets humanised.
- `FilterChips` props: `schema`, `registry`, `value`, `onChange`. Renders one removable `Pill` per top-level child. Nested groups show a summary like "(2 conditions, OR)". Removing emits a new node, or null when nothing is left.
- `FilterButton` props: everything FilterBuilder takes, plus `label?`. It is a `Button` with a `Badge` showing the active condition count (hidden at 0) that opens a `Popover` containing `FilterBuilder`. The popover stays open when inner dropdowns are clicked; this depends on the inner `withinPortal:false`.
- The barrel exports everything in this lane.

**Tests:**
- For the §8 AST, the chips read "Payment status is not Paid" and "Call status is within yesterday".
- Removing the first chip emits a filter with only the call-status condition.
- The count badge shows 2. With a null value there is no badge.
- Clicking the button opens the builder.
- Choosing a column option inside the popover keeps it open.

**Commit:** `feat(ui-mantine): filter chips summary and filter button popover`

### Task 17: Zod introspection (pure)
**Files:**
- `src/column-builder/zod-form/introspect.ts`
- Test: `src/column-builder/zod-form/introspect.test.ts`

**API:**
- `introspectZod(schema)` returns `FormFieldDescriptor`. The union covers:
  - `string`, `number`, `boolean`
  - `enum` (with values)
  - `optionList` (an array of objects with `label` and `value`, and optionally `color`)
  - `object` (with children)
  - `unsupported` (with a reason)
- Every descriptor carries `optional`, `defaultValue` and `description`.
- Supports Zod 3 (`_def.typeName`) and Zod 4 (`_zod.def.type`) through a small detection layer. Unwraps optional, default and nullable wrappers.

**Tests:**
- A string, number, boolean and enum object gives the matching descriptors in key order.
- `.optional()` sets `optional`. `.default(2)` sets `defaultValue` to 2.
- An array of `{label,value,color?}` gives `optionList`.
- Union and record give `unsupported`.
- The core select type's `configSchema` gives an `optionList`.
- The same assertions pass against a schema built with the other Zod major, where available.

**Commit:** `feat(ui-mantine): zod schema introspection for v3 and v4`

### Task 18: ZodForm renderer
**Files:**
- `src/column-builder/zod-form/ZodForm.tsx`, `OptionListField.tsx`, `JsonFallbackField.tsx`
- Test: `src/column-builder/zod-form/ZodForm.test.tsx`

**API:**
- `ZodForm` props: `schema`, `value`, `onChange`, `errors?` (path to message).
- Field mapping: string to `TextInput`, number to `NumberInput`, boolean to `Switch`, enum to `Select`.
- `optionList` renders `OptionListField`: rows of label `TextInput`, value (auto-derived from the label until edited), and a colour swatch picker (`ColorSwatch` buttons over Mantine's named palette inside a `Popover` with `withinPortal:false`). Rows can be added, removed and reordered with up/down buttons.
- Optional fields are marked as such. Defaults pre-fill.
- `unsupported` renders `JsonFallbackField`: a `JsonInput`, with a parse error shown inline.

**Tests:**
- The select `configSchema` renders an option list with an add button.
- Adding an option labelled "Paid" and choosing green emits `options:[{label:"Paid", value:"paid", color:"green"}]`.
- A boolean renders a switch.
- An unsupported union renders the JSON textarea. Invalid JSON shows an error and does not emit.
- Defaults appear as initial values.

**Commit:** `feat(ui-mantine): ZodForm renderer with option list and JSON fallback`

### Task 19: Column model, key slugging, common fields
**Files:**
- `src/column-builder/keys.ts`, `model.ts`, `CommonFields.tsx`
- Tests: `src/column-builder/keys.test.ts`, `src/column-builder/CommonFields.test.tsx`

**API:**
- `slugifyKey(label)` returns lowercase snake_case matching `^[a-z][a-z0-9_]*$`. Strips accents and prefixes `col_` when the label starts with a digit.
- `uniqueKey(base, existingKeys)` appends `_2`, `_3`, and so on.
- `ColumnDraft` plus reducer `columnDraftReducer`, with actions setType, setLabel, setKey (sets `keyTouched`), setConfig, setRequired, setDefault, setIndexed, setPermissions, setFormula.
- `buildColumnDef(draft, { schema, registry, now, generateId })`: returns a full `ColumnDef`.
  - `config` is parsed through `configSchema`.
  - `formula` is set only for formula columns.
  - `order` is max + 1 on create.
  - On edit, `id`, `key`, `order` and `createdAt` are kept.
- `CommonFields`: label, key (auto-slugged until touched; read-only in edit mode because formulas and stored data depend on it), required `Switch`, default value (renders the type's own inline editor from the ui registry), indexed `Switch`.

**Tests:**
- "Payment Status!" becomes `payment_status`. "2024 Revenue" becomes `col_2024_revenue`.
- A duplicate becomes `payment_status_2`.
- Typing a label updates the key until the key is edited by hand.
- Edit mode disables the key input.
- The default-value field for a select column renders the select editor.
- `buildColumnDef` fills createdAt and updatedAt from the injected `now`, and applies config defaults.

**Commit:** `feat(ui-mantine): column draft model, key slug and uniqueness, common fields`

### Task 20: Formula expression editor
**Files:**
- `src/column-builder/FormulaEditor.tsx`
- Test: `src/column-builder/FormulaEditor.test.tsx`

**API:**
- `FormulaEditor` props: `schema`, `access`, `value`, `onChange`, `selfKey?`.
- A `Textarea` inside a `Combobox` (`withinPortal:false`).
- Typing `{` opens the dropdown of readable, non-hidden column keys and labels. It excludes `selfKey`, and filters as the user types after `{`. Selecting replaces the partial token with `{key}` and places the caret after `}`.
- On each change, calls `parseFormula`. Errors show inline, with the position if one is given.
- On success, a `Badge` shows `inferResultType(ast, schema)` ("number", "text", "boolean" or "date").
- A self-reference or unknown key (checked via `dependencies`) shows an error.
- Exposes `onValidityChange(valid)` so the modal can gate Next.

**Tests:**
- Typing `{am` shows "amount". Choosing it produces `{amount}` with the caret after it.
- `{amount} * 2` shows a "number" badge.
- `CONCAT({notes}, "x")` shows "text".
- `{amount} *` shows a parse error.
- `{total}` inside the formula for `total` shows a self-reference error.
- Hidden `secret` is not offered.

**Commit:** `feat(ui-mantine): formula editor with {column} autocomplete and live type badge`

### Task 21: Permissions and preview steps
**Files:**
- `src/column-builder/PermissionsStep.tsx`, `PreviewStep.tsx`
- Tests: `src/column-builder/PermissionsStep.test.tsx`, `src/column-builder/PreviewStep.test.tsx`

**API:**
- `PermissionsStep` props: `value: ColumnPermissions`, `onChange`, `roles: string[]`. For each of read and edit: a `SegmentedControl` for "All" or "Roles", and in Roles mode a `MultiSelect` of roles.
  - Warns when the edit roles are not a subset of the read roles.
  - Selecting Roles with none chosen shows an error.
- `PreviewStep` props: `draft`, `registry`, `uiRegistry`. Shows a sample value (the field type's `defaultValue`, or a type-specific sample), the type's inline editor bound to local state, and the renderer showing the live value.

**Tests:**
- Switching read to Roles and picking "counsellor" emits `{read:{roles:["counsellor"]}, edit:"all"}` along with the subset warning.
- Roles mode with no roles shows the error.
- The preview for a select with options renders the badge for the sample.
- Editing in the preview updates the rendered badge.

**Commit:** `feat(ui-mantine): column permissions and live preview steps`

### Task 22: ColumnBuilderModal
**Files:**
- `src/column-builder/TypeStep.tsx`, `ConfigStep.tsx`, `ColumnBuilderModal.tsx`, `index.ts`
- Test: `src/column-builder/ColumnBuilderModal.test.tsx`

**API:**
- `ColumnBuilderModal` props: `opened`, `onClose`, `schema`, `registry`, `uiRegistry`, `access`, `roles`, `column?` (edit mode), `onSave(ColumnDef)`, `onDelete?(columnId)`, `now?`, `generateId?`.
- A `Modal` containing a `Stepper`: Type, Config, Permissions, Preview.
- `TypeStep` is a `SimpleGrid` of selectable type cards from `registry.list()`. In edit mode the type is locked.
- `ConfigStep` is `CommonFields`, then either `ZodForm` for the type's `configSchema` or `FormulaEditor` for formula.
- Next is gated by that step's validity.
- Save calls `onSave(buildColumnDef(...))`.
- Delete (edit mode only) asks for confirmation, then calls `onDelete`.

**Tests:**
- Create a select column "Payment Status" with options Paid, Pending, Failed and read access for all. Save emits a ColumnDef with `key:"payment_status"`, `type:"select"`, three options, permissions, and the injected id and timestamps.
- Next is disabled on Config while the label is empty.
- Choosing the formula type shows the formula editor. An invalid expression blocks Next.
- In edit mode the Type step is locked and the id is kept.
- Delete, then confirm, calls `onDelete(id)`.

**Commit:** `feat(ui-mantine): ColumnBuilderModal stepper emitting full ColumnDef`

### Task 23: ViewSwitcher
**Files:**
- `src/views/ViewSwitcher.tsx`
- Test: `src/views/ViewSwitcher.test.tsx`

**API:**
- Props: `views: ViewDef[]`, `activeViewId`, `onSelect(id)`, `onCreate(name)`, `onRename(id, name)`, `onDelete(id)`, `onSaveCurrent()`, `dirty`.
- A `Menu` target button shows the active view's name, with a dot indicator when dirty.
- Menu items: the views (checkmark on the active one), "Save changes" (enabled only when dirty), "Save as new view", "Rename", "Delete".
- Create and rename use an inline `TextInput` in a small `Modal`.
- Delete asks for confirmation. It is disabled when only one view is left.

**Tests:**
- Selecting a view calls `onSelect`.
- "Save changes" is disabled when not dirty and calls `onSaveCurrent` when dirty.
- Create with the name "Yesterday calls" calls `onCreate`.
- Rename prefills the current name.
- Delete is disabled for the last view.

**Commit:** `feat(ui-mantine): view switcher menu with save/create/rename/delete`

### Task 24: GroupByBar
**Files:**
- `src/views/GroupByBar.tsx`
- Test: `src/views/GroupByBar.test.tsx`

**API:**
- Props: `schema`, `registry`, `access`, `value: GroupSpec[]`, `onChange`, `maxGroups?` (default 3).
- Shows removable group-column `Pill`s and an add `Select` of groupable, non-hidden columns not already used.
- For each numeric column (number, currency, or a formula with a number result), a `Select` offers the aggregations from that type's `aggregations`.
- Emits `GroupSpec[]` with aggregations attached to the first group.

**Tests:**
- Adding "payment status" emits `[{columnId}]`.
- Setting amount to sum emits `aggregations:[{columnId:amount, agg:"sum"}]`.
- `secret` is not offered.
- The add select is disabled at `maxGroups`.

**Commit:** `feat(ui-mantine): group-by bar with per-numeric-column aggregations`

### Task 25: ConflictPopover and RemoteChangedBadge
**Files:**
- `src/conflict/ConflictPopover.tsx`, `RemoteChangedBadge.tsx`
- Test: `src/conflict/conflict.test.tsx`

**API:**
- `ConflictPopover` props: `conflict` (the core `ChangeResult` conflict entry), `column`, `registry`, `uiRegistry`, `now?`, `opened`, `onResolve(resolution: ConflictResolution)`, `children` (the target, i.e. the cell anchor).
  - Popover body: "Changed by {updatedBy.name ?? "someone"} {relative time}: {their value rendered by the type renderer}".
  - "Keep theirs" calls `onResolve("keepTheirs")`. "Overwrite" calls `onResolve("overwrite")`. These map directly to the ag-grid layer's resolution callback.
  - Escape closes without resolving.
  - Uses `withinPortal:false` so it stays anchored inside the grid's scroll container.
- `RemoteChangedBadge` props: `updatedBy?`, `updatedAt`, `now?`. A small dot `Indicator` with a `Tooltip` reading "Updated by X, 2 min ago".

**Tests:**
- The text contains "Changed by Asha 5 minutes ago" and the rendered "Paid" badge.
- Keep theirs calls `onResolve` with `"keepTheirs"`. Overwrite calls it with `"overwrite"`.
- A missing `updatedBy` falls back to "someone".
- Hovering the badge shows the tooltip text.

**Commit:** `feat(ui-mantine): conflict popover and remote-changed badge`

### Task 26: Import wizard, part 1 (model, upload, mapping)
**Files:**
- `src/import-export/import-model.ts`, `steps/UploadStep.tsx`, `steps/MapStep.tsx`, `ImportWizard.tsx` (first two steps)
- Tests: `src/import-export/import-model.test.ts`, `src/import-export/ImportWizard.map.test.tsx`

**API:**
- `importReducer` state: file, parsed, mapping, keyColumnId, mode, unknownEnumPolicy, preview, and step.
- `ImportWizard` props:
  - `schema`, `registry`, `access`
  - `io?` (injectable `parseFile`, `autoMapColumns` and `validateRows`, defaulting to the adapter)
  - `onPreview?(plan)`, a server-mode override returning validation results
  - `onCommit(plan: ImportPlan)`
  - `job?: ImportJobStatus`
  - `opened`, `onClose`
- The upload step is a `FileButton` with `accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"`. It shows the file name and size, and shows parse errors inline.
- The map step is a table of source headers. Each row has a `Select` of target columns (writable, non-hidden, non-formula, plus "Skip"), pre-filled by `autoMapColumns`.
- The mapping step also has a key column `Select` (required for update and upsert) and a mode `SegmentedControl` (create, update, upsert).
- Duplicate target mappings are flagged.

**Tests:**
- Uploading a CSV (a `File` with an injected `parseFile` stub returning the headers "Payment Status", "Call Date", "Unknown") auto-maps the first two to the right columns and the third to Skip.
- Changing a mapping updates the state.
- The upsert mode without a key column blocks Next with an error.
- The formula and hidden columns are not offered as targets.
- A duplicate mapping shows an error.

**Commit:** `feat(ui-mantine): import wizard upload and column mapping steps`

### Task 27: Import wizard, part 2 (preview and run)
**Files:**
- `steps/PreviewStep.tsx`, `steps/RunStep.tsx`, `ImportWizard.tsx` (completed)
- Test: `src/import-export/ImportWizard.preview.test.tsx`

**API:**
- The preview runs `validateRows` on the first 100 mapped rows, or calls `onPreview` when provided.
- It shows a `Table` where cells with errors get a red background and a `Tooltip` with the message.
- Summary counts: valid, invalid, unknown enum values.
- For unknown enum values, a `SegmentedControl` chooses "Create options" or "Reject rows". This sets `unknownEnumPolicy`.
- "Start import" calls `onCommit(plan)`.
- The run step shows a `Progress` from `job.processed / job.total`, the state text, and an error count. When the job provides `errorReportUrl`, an "Download error report" `Anchor` with `download` appears.

**Tests:**
- With `validateRows` stubbed to return an error for row 2, "Call Date", the cell has the error attribute and the tooltip message.
- Only 100 rows are validated even when 250 are parsed.
- Switching the enum policy to reject shows up in the committed plan.
- `onCommit` receives the mapping, mode and keyColumnId.
- A `job` prop of 50 out of 200 shows 25% progress. A done job with `errorReportUrl` shows the download link.

**Commit:** `feat(ui-mantine): import wizard preview validation and run progress`

### Task 28: ExportDialog
**Files:**
- `src/import-export/ExportDialog.tsx`, `index.ts`
- Test: `src/import-export/ExportDialog.test.tsx`

**API:**
- Props: `opened`, `onClose`, `visibleColumnCount`, `selectedRowCount`, `defaultScope?`, `onExport({ scope: "view"|"selected"|"all", format: "csv"|"xlsx" }) => Promise<void> | void`.
- A `Modal` with a `Radio.Group` for scope ("Selected" is disabled when `selectedRowCount` is 0), a `SegmentedControl` for format, and the note "Includes N visible columns".
- The confirm button shows a loader while `onExport` is pending and closes when it resolves.
- The barrel exports both the wizard and the dialog.

**Tests:**
- The note reads "Includes 7 visible columns".
- "Selected" is disabled at 0 selected rows.
- Choosing xlsx with scope all calls `onExport({scope:"all", format:"xlsx"})`.
- A rejected `onExport` shows an error and keeps the dialog open.

**Commit:** `feat(ui-mantine): export dialog with scope/format and visible column note`

### Task 29: notifyClipboardReport
**Files:**
- `src/notifications/notifyClipboardReport.ts`
- Test: `src/notifications/notifyClipboardReport.test.ts`

**API:**
- `formatClipboardReport(report)` (pure): returns `{ title, message, color }`, for example "Pasted 40 cells, 3 skipped (2 invalid, 1 read-only)". Red if everything failed, yellow for partial, green for full success.
- `notifyClipboardReport(report, options?)` returns `Promise<"shown" | "unavailable">`. It lazily loads `@mantine/notifications` with a non-static specifier (so bundlers don't hard-require it) and calls `notifications.show` with the formatted payload.
- `options.loader` can be injected for tests.
- It returns "unavailable" and never throws if the package is missing.
- The README documents that `<Notifications />` must be mounted.

**Tests:**
- The pure formatter produces the right text and colour for success, partial and failure.
- With a mocked loader, `show` is called with the title and message and the function returns "shown".
- A loader that rejects returns "unavailable" without throwing.

**Commit:** `feat(ui-mantine): optional notifications clipboard report toast`

### Task 30: Theme bridge
**Files:**
- `src/theme/useGridThemeFromMantine.ts`
- Test: `src/theme/useGridThemeFromMantine.test.tsx`

**API:**
- `useGridThemeFromMantine()` returns `{ colorScheme, cssVariables, params }`.
  - `cssVariables` maps AG Grid variables to Mantine CSS variable references, so dark/light switching follows Mantine automatically: `--ag-background-color` to `var(--mantine-color-body)`, and similarly foreground, border, accent (the primary colour's filled variable), header background, row hover, selected row, range-selection border, font family and font size.
  - `params` holds the resolved values for `themeQuartz.withParams`, taken from `useMantineTheme()` and `useComputedColorScheme()`.
- `mantineGridCssVariablesResolver`, a `CSSVariablesResolver`, is also exported for consumers who want the variables at provider level.

**Tests:**
- Inside the provider, `cssVariables["--ag-background-color"]` references the Mantine body variable.
- The accent follows a custom `primaryColor: "teal"`.
- `colorScheme` reflects `forceColorScheme="dark"`.
- The resolver returns both light and dark maps.

**Commit:** `feat(ui-mantine): Mantine to grid theme CSS variable bridge`

### Task 31: Exports, build, Playwright scenarios, changeset
**Files:**
- `src/index.ts` (final), `src/exports.test.ts`, `tsup.config.ts` (verify entries), `packages/ui-mantine/README.md`
- `docs/superpowers/plans/playwright-scenarios-ui.md`, `.changeset/ui-mantine-initial.md`

**API:**
- The root exports views, conflict, theme and notifications.
- Each subpath barrel exports its area only: `./editors` has editors, renderers and `createMantineUiRegistry`; `./filter-builder`, `./column-builder` and `./import-export` have their components and models.
- No barrel has top-level side effects (`sideEffects:false` holds).

**Tests (`exports.test.ts`):**
- Each subpath module imports and exposes its named exports: `createMantineUiRegistry`, `FilterBuilder`, `FilterChips`, `FilterButton`, `ColumnBuilderModal`, `ZodForm`, `ImportWizard`, `ExportDialog`, `ViewSwitcher`, `GroupByBar`, `ConflictPopover`, `RemoteChangedBadge`, `useGridThemeFromMantine`, `notifyClipboardReport`.
- `bun run --filter @masai/schema-grid-ui-mantine build` produces ESM, CJS and `.d.ts` for all 5 entries. This is a manual check noted in the task.

**Playwright doc contents** (behaviour jsdom cannot prove; run in apps/storybook):
1. Every popup editor inside a real AG Grid: clicking a dropdown option commits, and the edit does not stop early. Covers select, multi, creatable, date, datetime (including the time dropdown), user and link.
2. Keyboard in popup editors: Enter commits, Escape cancels, Tab moves to the next cell, and arrow keys move through options without the grid capturing them.
3. Popup editors near the grid's right or bottom edge are not clipped, and reposition correctly after horizontal scroll.
4. FilterButton popover: nested Select, MultiSelect and relative-date dropdowns do not close the popover. The §8 scenario end to end with demo-api: the saved view is reloaded the next day and still means "yesterday".
5. Formula autocomplete: caret position after insertion in a multi-line textarea, and IME input.
6. Column builder modal: focus trap, Stepper keyboard navigation, colour swatch popover inside the modal.
7. Import wizard with real CSV and XLSX files (FileButton native picker, a large-file job progress poll, the error report download).
8. Export dialog download of a real file.
9. The conflict popover stays anchored to the cell during grid scroll and virtualised row recycling.
10. Theme: toggling Mantine dark mode repaints the grid live.
11. The notifications toast appears for a paste report when `<Notifications />` is mounted, and nothing breaks when it is absent.

**Changeset:** minor bump for `@masai/schema-grid-ui-mantine` ("initial release").

**Commit:** `chore(ui-mantine): finalize subpath exports, playwright scenario notes, changeset`

---

## Summary

| Lane | Tasks | Order |
|---|---|---|
| Foundation | T1 scaffold → T2 contract adapters → T3 fixtures and helpers | Serial |
| A: editors | T4 text, T5 number/currency/checkbox, T6 dates, T7 select/multi, T8 creatable, T9 async combobox and user, T10 link, T11 renderers; then T12 registry | Parallel, then T12 |
| B: filters | T13 model → T14 value input → T15 FilterBuilder (§8 test) → T16 chips and button | Serial |
| C: column builder | T17 Zod introspection → T18 ZodForm; T19 key/slug and common fields; T20 formula editor; T21 permissions and preview; then T22 modal | T17→T18 serial, others parallel, T22 last |
| D: independent | T23 ViewSwitcher, T24 GroupByBar, T25 conflict popover, T28 ExportDialog | Parallel |
| E: import | T26 upload and mapping → T27 preview and run | Serial |
| F: independent | T29 notifications, T30 theme bridge | Parallel, need only T1 |
| Final | T31 exports, build, Playwright doc, changeset | After everything |
