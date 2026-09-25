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
