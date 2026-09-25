# Choosing a UI kit: ui-mantine vs ui-shadcn

Both kits plug into the same `@ranjeetk25/schema-grid-ag-grid` grid through the same contracts. Those
contracts are the `UiFieldTypeRegistry`, the `UiEditorProps`/`UiRendererProps` widget adapters, the
header-menu slot, `draftColumn`, and the `--sg-*` theme variables. Their public APIs match apart from "Mantine"
→ "Shadcn" renames, so switching kits means changing an import path and the provider or CSS setup.

**Rule of thumb:**
- If the host app already uses **Mantine 8** (admissions `public-ui` does), use **ui-mantine**. It adds almost
  nothing, because you already pay for Mantine.
- If the host uses **Tailwind or shadcn**, or has no UI library, use **ui-shadcn**. It needs no provider or
  global CSS reset and brings its own prebuilt CSS.

## At a glance

| | ui-mantine | ui-shadcn |
| --- | --- | --- |
| Built on | Mantine 8 (`@mantine/core`, `dates`, `hooks`, optional `notifications`), dayjs, Tabler icons | shadcn/ui source (Radix primitives), cmdk, react-day-picker 9, lucide-react, Tailwind CSS v4 (build time only) |
| Host must provide | `MantineProvider` (+ `DatesProvider`), Mantine's CSS, `mantineGridCssVariablesResolver` | One CSS import (`styles.css`); `.dark` on `<html>` for dark mode. No provider |
| Peers | react, react-dom, @mantine/* ^8, dayjs, zod | react, react-dom, ag-grid, zod; `sonner` optional |
| CSS shipped | none (uses Mantine's `styles.css`: 234 kB, 33 kB gzipped, plus dates at 23 kB) | `dist/styles.css`: 47 kB, 8.8 kB gzipped. Every utility prefixed `sg:`, no Preflight, reset scoped to `.sg-ui` |
| Re-theming | Mantine theme object + CSS variables resolver | Override `--sg-ui-*` tokens, or run the Tailwind v4 source entry with your own `@theme` |
| Dark mode | Mantine colour scheme manager | `.dark` class (shadcn convention); the grid follows through the token-derived `--sg-*` contract |
| Tests | Vitest + Testing Library | 582 Vitest tests (the ui-mantine behavioural suite ported, plus new ones) and a 4-case Playwright smoke |

## Bundle size

The table shows the kit's JS **with its UI-library dependencies bundled**. React, AG Grid, the schema-grid
packages, zod and the toast library are left external. It is measured with `bun build --minify --target
browser` on an entry that re-exports the whole root barrel (`export * from "<kit>"`), so every component
counts; real apps that import less ship less.

| | min | gzip | + CSS (gzip) |
| --- | --- | --- | --- |
| ui-mantine | 471 kB | 144 kB | about 33 kB (Mantine core) + 3 kB (dates) |
| ui-shadcn | 521 kB | 157 kB | 8.8 kB |

- **Heaviest dependencies in ui-shadcn** (esbuild metafile): react-day-picker 41 kB, tailwind-merge 28 kB,
  date-fns 23 kB, lucide-react 20 kB (tree-shaken icons), Radix Select 16 kB, Radix menu 13 kB, cmdk 12 kB.
  The kit's own components are about 216 kB minified.
- **For a host that already uses Mantine**, ui-mantine's marginal cost is only its own code, because Mantine
  is already in the app. **For a host that doesn't**, ui-shadcn is the lighter total once CSS is included,
  and it adds no global CSS.
- **Package tarballs** (from `bun run build`): ui-shadcn `dist/index.js` is 49 kB (12.7 kB gzipped); ui-mantine
  is 22 kB (6.4 kB gzipped). Both keep their dependencies external in dist.

## Accessibility

Both kits follow the same rules:
- Every control has an accessible name.
- Dialogs and popovers are named by their headings.
- Everything is reachable by keyboard.
- Errors appear only after touch or submit, and are announced (`role="alert"`).
- The grid's live region announces edits.

| | ui-mantine | ui-shadcn |
| --- | --- | --- |
| Primitives | Mantine Combobox / Popover / Modal | Radix (WAI-ARIA reference implementations: focus trap, roving tabindex, typeahead, dismissable layers) + cmdk listbox |
| Selects in cells | Mantine Combobox inside the popup | cmdk list inline in the popup card: arrows move, Enter picks the highlighted option and commits, typing filters, Esc cancels |
| Conflict popover | named by its heading (fixed in #09ba33d) | `aria-labelledby` its heading; doesn't steal focus from the grid |
| Filter builder | labelled selects | every row is a `group` named "Condition N"; AND/OR is a radio group; depth-2 lock explained in a tooltip |
| Column builder | stepper modal with a focus trap | non-modal side panel (grid stays operable); Esc asks before discarding a changed draft; the disabled primary button's tooltip lists what's missing |
| Known gap | — | Radix Avatar images don't load in jsdom (tests stub `HTMLImageElement`); no gap found in the browser |

## Design

Both kits implement the house style in `docs/design/README.md`: 13px chrome, 32px controls, 36px rows, zinc
neutrals and one accent. ui-shadcn goes further in these places, based on the Mantine-kit feedback:
- a right-side `ColumnPanel` with a live ghost column instead of a modal stepper;
- a single "Group" popover instead of permanent selects;
- live, debounced filter apply;
- a plain-English "Who can access" section;
- a width-aware multi-select clamp.

Screenshots are in `docs/design/shadcn/` (1440×900, light and dark; the iteration sequence is in `progress/`),
and the Mantine ones are in `docs/design/before|after/`.

## How to run each Storybook

- Mantine: `bun run storybook` (port 6006).
- shadcn: `bun run storybook:shadcn` (port 6007; the toolbar has a light/dark toggle). Its Playwright smoke is
  `bun run e2e:shadcn`, which serves a static build on 6107.
