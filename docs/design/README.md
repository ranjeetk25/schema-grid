# schema-grid design language

The grid is a work tool that people stare at all day. We borrow three things:

- **Linear — density and scale.** 13px chrome, 32px controls, 36px rows and
  header, an 8px spacing grid, compact popovers, keyboard hints next to actions.
- **Vercel — restraint.** Near-monochrome zinc neutrals, white surfaces, 1px
  hairlines, ONE accent colour, soft elevation only on floating layers.
- **Airbnb — warmth and clarity.** Generous padding where a person reads or
  decides (modals, wizards), one title and one primary action per surface,
  friendly empty states, muted helper text, errors only after touch/submit.

`before/` and `after/` hold the review screenshots (light + dark);
`progress/` is the step-by-step audit trail taken after every visual change
(`NN-*` workbench/theme, `A-*` ag-grid, `B-*` filters/views, `C-*`
editors/renderers/column panel).
Regenerate with `bun apps/storybook/scripts/capture-design.ts after`
against a running Storybook (`ONLY=client-grid,…` for a subset).

## Tokens

### Type

| Token | Size | Use |
| --- | --- | --- |
| `xs` | 12px | helper text, captions, badges, kbd hints |
| `sm` | 13px | **base**: grid cells, headers, controls, menus |
| `md` | 14px | modal body copy |
| `lg` | 16px | modal / dialog title (weight 600) |
| `xl` | 20px | page title in hosts (rare) |

- Font: `ui-sans-serif, system-ui, -apple-system, "Segoe UI", Inter, sans-serif`.
  Mono: `ui-monospace, "SF Mono", Menlo, monospace` (keys, formulas, kbd).
- Weights: 400 body, 500 labels/header cells/buttons, 600 titles. Nothing bolder.
- Numbers in cells and counters use `font-variant-numeric: tabular-nums`.

### Spacing (8px grid, 4px half-step)

`4 · 8 · 12 · 16 · 24 · 32`. Mantine spacing: `xs 8, sm 12, md 16, lg 24, xl 32`.
Grid `spacing` param is 6 (AG Grid multiplies it for cell padding → 12px).

### Radii

| Token | Value | Use |
| --- | --- | --- |
| `xs` | 4px | badges, chips, kbd, checkboxes |
| `sm` / `md` (default) | 6px | inputs, buttons, menu items |
| `lg` | 8px | grid wrapper, popovers, menus, cards |
| `xl` | 12px | modals |

### Heights

Controls 32px (`size="sm"`; `xs` = 28px for inline/pill controls), grid rows
36px, grid header 36px, menu items 30px.

### Colour

Neutrals are zinc. The accent is Mantine's primary colour (`brand`, a
Linear-like indigo, `#5e6ad2` at shade 6) and is used ONLY for: focus rings,
selection/range, checked checkboxes, the active-filter indicator and the
selected-item checkmark. Everything else is neutral.

The primary button is **monochrome** (Vercel): zinc-900 with white text on
light, near-white with zinc-950 text on dark (`--sg-cta-*`). Any filled
`<Button>` without an explicit `color` gets this; destructive actions pass
`color="red"`.

| Role | Light | Dark |
| --- | --- | --- |
| Surface (grid, popover, modal) | `#ffffff` | `#18181b` |
| Page / subtle fill (header, hover) | `#fafafa` | `#1f1f23` |
| Hairline border | `#e4e4e7` | `#2e2e33` |
| Text | `#09090b` | `#e4e4e7` |
| Muted text (helper, counts, status bar) | `#71717a` | `#a1a1aa` |
| Accent | `#5e6ad2` | `#7c86dc` |
| Danger | `#dc2626` | `#f87171` |

Semantic badge colours (status options) use Mantine `variant="light"` and
muted tones; option colour dots are 8px circles.

Elevation: only floating layers (popover, menu, modal, filter popup) get a
shadow — `0 8px 24px -6px rgb(0 0 0 / .12), 0 0 0 1px rgb(0 0 0 / .06)`
(dark: stronger black, hairline in `#2e2e33`). Static surfaces never do.

### Grid CSS variables (the contract between packages)

`@ranjeetk25/schema-grid-ag-grid`'s theme reads these (each has a light fallback);
`mantineGridCssVariablesResolver` in ui-mantine sets them from the Mantine
theme so the grid follows Mantine's primary colour and colour scheme:

`--sg-accent-color`, `--sg-background-color`, `--sg-foreground-color`,
`--sg-muted-foreground-color`, `--sg-border-color`,
`--sg-header-background-color`, `--sg-header-foreground-color`,
`--sg-row-hover-color`, `--sg-selected-row-background-color`,
`--sg-range-bg`, `--sg-range-border`, `--sg-font-family`, `--sg-font-size`,
`--sg-popup-shadow`, `--sg-danger-color`.

## Rules

1. **One primary action per surface.** Secondary actions are `variant="default"`
   or `subtle`; destructive ones are `color="red"` `variant="subtle"` and sit
   apart from the primary.
2. **No borders on everything.** Separate regions with a background shift
   (`#fafafa` header vs `#fff` body) or a single hairline. No box-in-a-box.
3. **Errors appear after touch or submit, never on first paint.** Validation
   runs on blur/submit; required fields show an asterisk, not a red border.
4. **Muted helper text** (`c="dimmed"`, 12px) sits under its field.
5. **Icons** are Tabler (`@tabler/icons-react`, 16px, stroke 1.75) in
   ui-mantine; the framework-free ag-grid package uses inline SVG at the same
   size. Icon-only buttons always carry an `aria-label` and a tooltip.
6. **Keyboard hints** sit in tooltips and menus as ONE muted mono string
   ("⌘⇧Z", 11px, 60% opacity) — never a row of key chips. Tooltips are
   zinc-900 (dark: zinc-700), 12px, radius 6, padding 4×8, open after 400ms,
   placed below the control with a 6px offset.
7. **Dark mode** is designed, not inverted: every token above has a dark value;
   check both schemes before merging.
8. **Motion** 120–180ms ease-out for popovers/menus; no decorative animation.
9. **Toolbar icon actions** are ghost `ActionIcon`s (subtle, 32px, radius 6,
   faint hover fill) — no grouped border boxes; unavailable = 40% opacity.
10. **Segmented controls** (role switcher, AND/OR): transparent track, no
    separators, the active item is a raised chip (surface + hairline + tiny
    shadow), 12px text.

## Decisions

### No floating-filter row; the filter lives in the header cell

AG Grid's floating-filter row cost a full 36px row that held nothing but
icons. `floatingFilter` is now **off by default** (`compileColumns` /
`useSchemaGrid`), with an opt-in `floatingFilters` prop that restores
`FloatingFilter` (the read-only summary chip) for hosts that want it.

The filter affordance moved into a custom header component (`SchemaHeader`):
label + sort indicator + a small filter icon button (`.sg-header-filter`).
The icon is invisible until the header is hovered or focused, and stays
visible and accent-tinted while that column has an active filter. Header
height stays 36px.

Keyboard: Enter on a header sorts (AG Grid's own behaviour); Ctrl/Cmd+Enter,
Shift+Enter or Alt+ArrowDown opens the column filter. The button's
accessible name states the filter state ("Filter Payment status", or
"Filter Payment status (active)").

### Column filter chrome

- ag-grid (framework-free default): plain elements dressed in AG Grid's own
  theme classes (`ag-input-field-input ag-text-field-input`, `ag-picker-field`,
  `ag-standard-button`, `ag-filter-apply-panel`, `--ag-spacing`) so they look
  native to whatever AG Grid theme is active. Layout follows AG Grid's text
  filter: operator, value, then an Apply / Clear row.
- ui-mantine registers Mantine `filterComponent`s for every type via
  `createMantineUiRegistry`: an operator picker, a type-aware value input and
  a searchable checkbox list for set-like types. Their dropdowns render
  inside the AG Grid popup (`withinPortal: false`) so a click in them does not
  close the filter.

### Header labels use the text colour

Header labels are the foreground colour at weight 500 (not muted): muted
labels read as disabled next to 13px cell text. Sort and filter icons are
14px ghosts on the right of the same 36px row.

### Popups mount on `document.body`

Popup editors and filters render in AG Grid's popup parent on the body
(`popupParent` prop, default `document.body`) so calendars and pickers are
never cropped by the viewport; they open under the cell. Exactly one layer
(`.sg-popup-editor`) draws the card chrome.

### Booleans toggle in place

Click the checkbox, or press Space/Enter on the cell: the value flips through
the normal edit pipeline (undo, announcements). No editor opens. Read-only
cells (formula or no permission) are muted and announce why on an edit
attempt ("Read-only: computed by formula").

### Live filtering, explicit on large data

The filter builder applies as you edit (300ms debounce). Above
`liveFilterThreshold` (server total > 5,000, or client rows > 10,000) it
switches to a draft with "Apply filter". Incomplete conditions are never
applied; a failed apply keeps the previous filter and shows the error inline;
chips always show the applied filter.

### Grouping

One "Group" button with a popover (group columns, collapsed "Summaries").
Group rows are 32px, tinted, show the value with the column's own renderer,
a muted count and right-aligned aggregates; nested levels indent 16px, data
rows under a group indent their first cell. Collapsed groups persist in the
view (`ViewDef.collapsedGroups`).

### Columns are built in a side panel

"Add column", the header menu ("Edit column…", "Insert left/right") and the
trailing "+" open `ColumnPanel`, a 420px right-side panel with no overlay:
one scrolling form (name → type picker → type settings → options → who can
access). While it is open the grid shows the draft as a ghost column at the
insertion point (`draftColumn`), which becomes real on save. The grid makes
room for the panel instead of hiding under it.

### Status bars show only what happened

No `none` / `null` / `0` placeholders: empty entries are hidden, and an idle
bar reads "No changes yet". Raw values for tests live in visually hidden
`data-testid` spans.
