/**
 * Class name constants and raw CSS for our own cell/row decorations
 * (range selection, pending/error/remote-changed cells, the fill handle,
 * group rows, "load more" rows, and rows scrolled out of view).
 *
 * Every selector below is scoped under `.sg-root` (the class the grid's
 * wrapping element carries) so this CSS never leaks onto the rest of the
 * host page when shipped as a plain stylesheet. `theme.ts` injects the
 * part-scoped variant (`SG_THEME_CSS`) via the Theming API's `createPart`
 * `css` option; `SG_CSS` is exported raw so a consumer that can't use the
 * Theming part mechanism can ship it as a stylesheet instead.
 */

export const SG_CLASSES = {
  root: "sg-root",
  range: "sg-cell-range",
  rangeTop: "sg-cell-range-top",
  rangeRight: "sg-cell-range-right",
  rangeBottom: "sg-cell-range-bottom",
  rangeLeft: "sg-cell-range-left",
  pending: "sg-cell-pending",
  error: "sg-cell-error",
  remoteChanged: "sg-cell-remote-changed",
  notInView: "sg-row-not-in-view",
  fillHandle: "sg-fill-handle",
  fillPreview: "sg-cell-fill-preview",
  groupRow: "sg-group-row",
  loadMoreRow: "sg-load-more-row",
  /** Permission read-only cell (column or row level). */
  readOnly: "sg-cell-readonly",
  /** Formula (computed, never editable) cell. */
  formula: "sg-cell-formula",
  /** Transient flash when an edit is attempted on a read-only cell. */
  readOnlyHint: "sg-cell-readonly-hint",
} as const;

export type SgClassName = (typeof SG_CLASSES)[keyof typeof SG_CLASSES];

// Design tokens as CSS values. `--ag-*` are set by the theme (so theme
// overrides flow through); the `--sg-*` / literal fallbacks cover the plain
// `SG_CSS` stylesheet path. Light fallbacks follow docs/design/README.md.
const ACCENT = "var(--ag-accent-color, var(--sg-accent-color, #5e6ad2))";
const SURFACE = "var(--ag-background-color, var(--sg-background-color, #ffffff))";
const TEXT = "var(--ag-foreground-color, var(--sg-foreground-color, #09090b))";
const MUTED = "var(--ag-subtle-text-color, var(--sg-muted-foreground-color, #71717a))";
const BORDER = "var(--ag-border-color, var(--sg-border-color, #e4e4e7))";
const FILL = "var(--sg-header-background-color, #fafafa)";
const HOVER = `color-mix(in srgb, ${TEXT} 5%, transparent)`;
const DANGER = "var(--sg-danger-color, #dc2626)";
const POPUP_SHADOW = "var(--sg-popup-shadow, 0 8px 24px -6px rgb(0 0 0 / .12), 0 0 0 1px rgb(0 0 0 / .06))";
const FOCUS_RING = `0 0 0 2px color-mix(in srgb, ${ACCENT} 22%, transparent)`;
const CHEVRON =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='%238b8b94' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")";
const R = `.${SG_CLASSES.root}`;
const EDGE = "2px";

/** Cell/row decorations (range, status, fill, group rows). Every selector scoped under `.sg-root`. */
const SG_DECORATION_CSS = `
${R} .ag-cell {
  font-variant-numeric: tabular-nums;
}

${R} .ag-cell a {
  color: inherit;
  text-decoration: underline;
  text-decoration-color: color-mix(in srgb, ${TEXT} 25%, transparent);
  text-underline-offset: 2px;
}

${R} .ag-cell a:hover {
  text-decoration-color: currentColor;
}

${R} .${SG_CLASSES.range} {
  background-color: var(--sg-range-bg, color-mix(in srgb, ${ACCENT} 8%, transparent));
}

${R} .${SG_CLASSES.rangeTop}::before,
${R} .${SG_CLASSES.rangeRight}::before,
${R} .${SG_CLASSES.rangeBottom}::before,
${R} .${SG_CLASSES.rangeLeft}::before {
  content: "";
  position: absolute;
  inset: 0;
  pointer-events: none;
  border: 0 solid var(--sg-range-border, ${ACCENT});
  z-index: 1;
}

${R} .${SG_CLASSES.rangeTop}::before {
  border-top-width: ${EDGE};
}

${R} .${SG_CLASSES.rangeRight}::before {
  border-right-width: ${EDGE};
}

${R} .${SG_CLASSES.rangeBottom}::before {
  border-bottom-width: ${EDGE};
}

${R} .${SG_CLASSES.rangeLeft}::before {
  border-left-width: ${EDGE};
}

${R} .${SG_CLASSES.pending} {
  background-color: var(--sg-pending-bg, rgba(245, 158, 11, 0.1));
}

${R} .${SG_CLASSES.error} {
  background-color: var(--sg-error-bg, color-mix(in srgb, ${DANGER} 7%, transparent));
  box-shadow: inset 0 0 0 1px var(--sg-error-border, color-mix(in srgb, ${DANGER} 55%, transparent));
}

${R} .${SG_CLASSES.remoteChanged} {
  animation: sg-remote-flash var(--sg-remote-flash-duration, 1.2s) ease-out;
}

${R} .${SG_CLASSES.readOnly} {
  color: color-mix(in srgb, ${TEXT} 78%, transparent);
  cursor: default;
}

${R} .${SG_CLASSES.formula} {
  color: ${MUTED};
  cursor: default;
}

${R} .${SG_CLASSES.readOnlyHint} {
  animation: sg-readonly-hint 600ms ease-out;
}

${R} .${SG_CLASSES.notInView} {
  opacity: var(--sg-not-in-view-opacity, 0.5);
}

${R} .${SG_CLASSES.fillHandle} {
  position: absolute;
  width: var(--sg-fill-handle-size, 7px);
  height: var(--sg-fill-handle-size, 7px);
  right: 2px;
  bottom: 2px;
  z-index: 2;
  border-radius: 50%;
  background-color: var(--sg-range-border, ${ACCENT});
  box-shadow: 0 0 0 2px var(--sg-fill-handle-border, ${SURFACE});
  cursor: crosshair;
}

${R} .${SG_CLASSES.fillPreview} {
  background-color: var(--sg-fill-preview-bg, color-mix(in srgb, ${ACCENT} 5%, transparent));
  outline: 1px dashed var(--sg-range-border, ${ACCENT});
  outline-offset: -1px;
}

${R} .${SG_CLASSES.groupRow} {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: 6px;
  height: 100%;
  padding-right: var(--ag-cell-horizontal-padding, 12px);
  color: ${TEXT};
  font-weight: 500;
  white-space: nowrap;
}

${R} .ag-row.sg-row-group {
  background-color: var(--sg-group-row-bg, ${FILL});
  border-top: 1px solid ${BORDER};
}

${R} .ag-row.sg-row-group-l1 {
  background-color: color-mix(in srgb, var(--sg-group-row-bg, ${FILL}) 60%, ${SURFACE});
}

${R} .ag-row.sg-row-group-l2,
${R} .ag-row.sg-row-group-l3,
${R} .ag-row.sg-row-group-l4,
${R} .ag-row.sg-row-group-l5 {
  background-color: color-mix(in srgb, var(--sg-group-row-bg, ${FILL}) 30%, ${SURFACE});
}

${R} .ag-row.sg-row-group.ag-row-first {
  border-top-color: transparent;
}

${R} .ag-row.sg-row-grouped {
  border-bottom-color: color-mix(in srgb, ${BORDER} 45%, transparent);
}

${R} .sg-row-grouped-l1 .ag-cell[aria-colindex="1"] {
  padding-left: calc(var(--ag-cell-horizontal-padding, 12px) + 24px);
}

${R} .sg-row-grouped-l2 .ag-cell[aria-colindex="1"] {
  padding-left: calc(var(--ag-cell-horizontal-padding, 12px) + 48px);
}

${R} .sg-row-grouped-l3 .ag-cell[aria-colindex="1"] {
  padding-left: calc(var(--ag-cell-horizontal-padding, 12px) + 72px);
}

${R} .sg-row-grouped-l4 .ag-cell[aria-colindex="1"],
${R} .sg-row-grouped-l5 .ag-cell[aria-colindex="1"] {
  padding-left: calc(var(--ag-cell-horizontal-padding, 12px) + 96px);
}

${R} .sg-group-toggle {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  margin: 0 0 0 -4px;
  padding: 0;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: ${MUTED};
  cursor: pointer;
}

${R} .sg-group-toggle:hover {
  background-color: ${HOVER};
  color: ${TEXT};
}

${R} .sg-group-toggle svg {
  transition: transform 150ms ease-out;
}

${R} .sg-group-toggle[aria-expanded="true"] svg {
  transform: rotate(90deg);
}

${R} .sg-group-label {
  display: inline-flex;
  align-items: center;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

${R} .sg-group-empty {
  color: ${MUTED};
  font-style: italic;
  font-weight: 400;
}

${R} .sg-group-sep,
${R} .sg-group-count {
  flex: none;
  color: ${MUTED};
  font-weight: 400;
  font-variant-numeric: tabular-nums;
}

${R} .sg-group-aggs {
  display: flex;
  flex: none;
  gap: 16px;
  margin-left: auto;
  padding-left: 16px;
  font-size: 12px;
  font-weight: 400;
  font-variant-numeric: tabular-nums;
}

${R} .sg-group-agg-label {
  color: ${MUTED};
}

${R} .sg-group-agg-value {
  color: ${TEXT};
}

${R} .${SG_CLASSES.loadMoreRow},
${R} .sg-load-more {
  display: flex;
  align-items: center;
  height: 100%;
  color: var(--sg-load-more-color, ${MUTED});
}

${R} .sg-load-more-button {
  height: 24px;
  margin: 0 0 0 -8px;
  padding: 0 8px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}

${R} .sg-load-more-button:hover {
  background-color: ${HOVER};
  color: ${TEXT};
}
`;

const CHECK =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='none' stroke='white' stroke-width='2.25' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m4 8.5 2.5 2.5L12 5.5'/%3E%3C/svg%3E\")";

/** Default boolean renderer: a 16px checkbox (accent fill + white check when checked). */
const SG_BOOLEAN_CSS = `
${R} .sg-bool-cell {
  display: flex;
  align-items: center;
  height: 100%;
}

${R} .sg-bool {
  appearance: none;
  box-sizing: border-box;
  flex: none;
  width: 16px;
  height: 16px;
  margin: 0;
  border: 1px solid color-mix(in srgb, ${TEXT} 30%, transparent);
  border-radius: 4px;
  background-color: ${SURFACE};
  opacity: 1;
  pointer-events: none;
}

${R} .sg-bool:checked {
  border-color: ${ACCENT};
  background: ${ACCENT} ${CHECK} center / 12px no-repeat;
}

${R} .sg-bool-readonly {
  opacity: 0.5;
}
`;

/** `SchemaHeader`: label, sort indicator and the hover-revealed filter button. */
const SG_HEADER_CSS = `
${R} .ag-header-cell-comp-wrapper {
  width: 100%;
}

${R} .sg-header {
  display: flex;
  align-items: center;
  gap: 4px;
  width: 100%;
  height: 100%;
  min-width: 0;
}

${R} .sg-header-label {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: 1 1 auto;
  min-width: 0;
  height: 100%;
}

${R} .sg-header[data-sortable] .sg-header-label {
  cursor: pointer;
}

${R} .sg-header .ag-header-cell-text {
  flex: 0 1 auto;
  min-width: 0;
  color: var(--ag-header-text-color, ${TEXT});
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

${R} .sg-header-sort {
  display: inline-flex;
  flex: none;
  margin-left: auto;
  align-items: center;
  gap: 1px;
  color: ${TEXT};
}

${R} .sg-header-sort-index {
  font-size: 10px;
  font-variant-numeric: tabular-nums;
}

${R} .sg-header-filter,
${R} .sg-header-menu {
  position: relative;
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  margin: 0;
  padding: 2px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  box-shadow: none;
  color: ${MUTED};
  cursor: pointer;
  transition: background-color 120ms ease-out, color 120ms ease-out;
}

${R} .sg-header-filter:hover,
${R} .sg-header-menu:hover,
${R} .sg-header-menu[aria-expanded="true"] {
  background-color: color-mix(in srgb, ${TEXT} 7%, var(--ag-header-background-color, ${FILL}));
  color: ${TEXT};
}

${R} .sg-header-actions {
  position: absolute;
  top: 50%;
  right: -4px;
  display: flex;
  align-items: center;
  gap: 1px;
  padding-left: 6px;
  transform: translateY(-50%);
  background-color: var(--ag-header-background-color, ${FILL});
  box-shadow: -10px 0 8px -4px var(--ag-header-background-color, ${FILL});
  opacity: 0;
  visibility: hidden;
  transition: opacity 120ms ease-out, visibility 120ms;
}

${R} .ag-header-cell:hover .sg-header-actions,
${R} .ag-header-cell:focus-within .sg-header-actions,
${R} .ag-header-cell:focus .sg-header-actions,
${R} .sg-header[data-menu-open] .sg-header-actions {
  opacity: 1;
  visibility: visible;
}

${R} .sg-header[data-filter-active] .sg-header-actions {
  position: static;
  padding-left: 0;
  transform: none;
  background: transparent;
  box-shadow: none;
  opacity: 1;
}

${R} .sg-header-filter-active {
  visibility: visible;
}

${R} .sg-header-filter-active,
${R} .sg-header-filter-active:hover {
  color: ${ACCENT};
}

${R} .sg-header-filter-dot {
  position: absolute;
  top: 3px;
  right: 3px;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background-color: ${ACCENT};
  box-shadow: 0 0 0 1.5px var(--ag-header-background-color, ${FILL});
}

${R} .sg-header-ghost .ag-header-cell-text {
  color: ${MUTED};
  font-style: italic;
  font-weight: 400;
}

${R} .sg-header-ghost,
${R} .sg-cell-ghost {
  background-color: color-mix(in srgb, ${ACCENT} 4%, transparent);
}

${R} .sg-cell-ghost {
  color: ${MUTED};
  cursor: default;
}

${R} .sg-header-add-cell {
  padding: 0;
}

${R} .sg-header-add-wrap {
  justify-content: center;
}

${R} .sg-header-add {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  margin: 0;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: ${MUTED};
  cursor: pointer;
  transition: background-color 120ms ease-out, color 120ms ease-out;
}

${R} .sg-header-add:hover {
  background-color: color-mix(in srgb, ${TEXT} 7%, var(--ag-header-background-color, ${FILL}));
  color: ${TEXT};
}

${R} .sg-header-add:focus-visible {
  outline: none;
  box-shadow: ${FOCUS_RING};
}

${R} .sg-cell-add {
  pointer-events: none;
}

${R} .sg-menu {
  box-sizing: border-box;
  z-index: 1000;
  display: flex;
  flex-direction: column;
  width: 208px;
  padding: 4px;
  border: 1px solid ${BORDER};
  border-radius: 8px;
  background-color: ${SURFACE};
  box-shadow: ${POPUP_SHADOW};
  color: ${TEXT};
  font-family: var(--ag-font-family, inherit);
  font-size: 13px;
  animation: sg-menu-in 140ms ease-out;
}

${R} .sg-menu-item {
  position: relative;
  display: flex;
  align-items: center;
  height: 30px;
  margin: 0;
  padding: 0 8px 0 28px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  outline: none;
}

${R} .sg-menu-item:hover,
${R} .sg-menu-item:focus-visible,
${R} .sg-menu-item:focus {
  background-color: ${HOVER};
}

${R} .sg-menu-item[aria-checked="true"]::before {
  content: "";
  position: absolute;
  left: 11px;
  top: 50%;
  width: 4px;
  height: 8px;
  border: solid ${ACCENT};
  border-width: 0 1.75px 1.75px 0;
  transform: translate(0, -60%) rotate(45deg);
}

${R} .sg-menu-separator {
  height: 1px;
  margin: 4px -4px;
  border: 0;
  background-color: ${BORDER};
}

${R} .ag-pinned-left-header,
${R} .ag-pinned-left-cols-container {
  box-shadow: 4px 0 6px -4px rgb(0 0 0 / 0.1);
  z-index: 1;
}

${R} .ag-pinned-right-header,
${R} .ag-pinned-right-cols-container {
  box-shadow: -4px 0 6px -4px rgb(0 0 0 / 0.1);
  z-index: 1;
}
`;

/** Shared control chrome (inputs, selects, buttons) for filters and popup editors. */
const SG_CONTROLS_CSS = `
${R} .sg-input,
${R} .sg-select {
  box-sizing: border-box;
  width: 100%;
  height: 30px;
  margin: 0;
  padding: 0 8px;
  border: 1px solid ${BORDER};
  border-radius: 6px;
  background-color: ${SURFACE};
  color: ${TEXT};
  font: inherit;
  font-size: 13px;
  outline: none;
  transition: border-color 120ms ease-out, box-shadow 120ms ease-out;
}

${R} .sg-select {
  appearance: none;
  padding-right: 28px;
  background-image: ${CHEVRON};
  background-repeat: no-repeat;
  background-position: right 8px center;
  background-size: 14px;
  cursor: pointer;
}

${R} .sg-input::placeholder {
  color: ${MUTED};
}

${R} .sg-input:focus,
${R} .sg-select:focus {
  border-color: ${ACCENT};
  box-shadow: ${FOCUS_RING};
}

${R} .sg-input[aria-invalid="true"] {
  border-color: ${DANGER};
}

${R} .sg-button {
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 28px;
  margin: 0;
  padding: 0 12px;
  border: 1px solid ${BORDER};
  border-radius: 6px;
  background-color: ${SURFACE};
  color: ${TEXT};
  font: inherit;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 120ms ease-out, border-color 120ms ease-out;
}

${R} .sg-button:hover {
  background-color: ${FILL};
}

${R} .sg-button:focus-visible {
  outline: none;
  box-shadow: ${FOCUS_RING};
}

${R} .sg-button-primary {
  border-color: ${ACCENT};
  background-color: ${ACCENT};
  color: #ffffff;
}

${R} .sg-button-primary:hover {
  border-color: color-mix(in srgb, ${ACCENT} 88%, #000000);
  background-color: color-mix(in srgb, ${ACCENT} 88%, #000000);
}

${R} .sg-checkbox {
  flex: none;
  width: 14px;
  height: 14px;
  margin: 0;
  accent-color: ${ACCENT};
  cursor: pointer;
}
`;

/** Column filter popups (`ConditionFilter`, `SetFilter`) and the opt-in floating filter chip. */
const SG_FILTER_CSS = `
${R} .sg-filter {
  box-sizing: border-box;
  width: 240px;
  color: ${TEXT};
  font-size: 13px;
}

${R} .sg-filter-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: calc(var(--ag-spacing, 6px) * 2);
}

${R} .sg-filter-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin: 0;
  padding: 8px calc(var(--ag-spacing, 6px) * 2);
  border-top: 1px solid ${BORDER};
}

${R} .sg-filter-error {
  color: ${DANGER};
  font-size: 12px;
}

${R} .sg-filter-options {
  display: flex;
  flex-direction: column;
  max-height: 240px;
  margin: 0 -4px;
  overflow: auto;
}

${R} .sg-filter-option {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 28px;
  padding: 0 6px;
  border-radius: 4px;
  cursor: pointer;
  user-select: none;
}

${R} .sg-filter-option:hover {
  background-color: ${HOVER};
}

${R} .sg-filter-empty {
  padding: 6px;
  color: ${MUTED};
  font-size: 12px;
}

${R} .sg-floating-filter {
  display: flex;
  align-items: center;
  gap: 4px;
  width: 100%;
  min-width: 0;
}

${R} .sg-filter-chip {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  max-width: 100%;
  height: 22px;
  padding: 0 2px 0 8px;
  border-radius: 4px;
  background-color: color-mix(in srgb, ${ACCENT} 10%, transparent);
  color: ${ACCENT};
  font-size: 12px;
  font-weight: 500;
}

${R} .sg-filter-chip-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

${R} .sg-filter-chip-clear {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  padding: 0;
  border: 0;
  border-radius: 3px;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
}

${R} .sg-filter-chip-clear:hover {
  background-color: color-mix(in srgb, ${ACCENT} 14%, transparent);
}

${R} .sg-filter-advanced {
  padding: 1px 6px;
  border: 1px solid ${BORDER};
  border-radius: 4px;
  color: ${MUTED};
  font-size: 11px;
}
`;

/** Cell editors: inline editors fill the cell; popup editors get the popup surface. */
const SG_EDITOR_CSS = `
${R} .sg-cell-editor {
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  margin: 0;
  padding: 0 calc(var(--ag-cell-horizontal-padding, 12px) - 1px);
  border: 0;
  border-radius: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  font-variant-numeric: tabular-nums;
  outline: none;
}

${R} .sg-select-editor {
  appearance: none;
  padding-right: 28px;
  background-image: ${CHEVRON};
  background-repeat: no-repeat;
  background-position: right 8px center;
  background-size: 14px;
  cursor: pointer;
}

${R} .sg-boolean-editor {
  width: 14px;
  height: 14px;
  margin: 0 var(--ag-cell-horizontal-padding, 12px);
  padding: 0;
  vertical-align: middle;
  accent-color: ${ACCENT};
}

${R} .ag-popup-editor {
  max-height: none;
  overflow: visible;
  border: 0;
  background: transparent;
  box-shadow: none;
}

${R} .sg-popup-editor {
  box-sizing: border-box;
  min-width: 200px;
  padding: 4px;
  border: 1px solid ${BORDER};
  border-radius: 8px;
  background-color: ${SURFACE};
  box-shadow: ${POPUP_SHADOW};
  color: ${TEXT};
  font-size: 13px;
  outline: none;
}

${R} .sg-long-text-editor {
  display: block;
  width: 320px;
  max-width: 100%;
  min-height: 112px;
  height: auto;
  padding: 6px 8px;
  line-height: 1.5;
  resize: vertical;
}

${R} .sg-multi-select-editor,
${R} .sg-combobox-listbox {
  display: flex;
  flex-direction: column;
  max-height: 280px;
  overflow: auto;
}

${R} .sg-combobox-editor {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 232px;
}

${R} .sg-popup-editor .sg-combobox-input {
  height: 30px;
  padding: 0 8px;
  border: 1px solid ${BORDER};
  border-radius: 6px;
  background-color: ${SURFACE};
}

${R} .sg-popup-editor .sg-combobox-input:focus {
  border-color: ${ACCENT};
  box-shadow: ${FOCUS_RING};
}

${R} .sg-multi-select-option,
${R} .sg-combobox-option {
  position: relative;
  display: flex;
  flex: none;
  align-items: center;
  gap: 8px;
  height: 30px;
  padding: 0 8px;
  border-radius: 6px;
  cursor: pointer;
  user-select: none;
  white-space: nowrap;
}

${R} .sg-combobox-option {
  padding-left: 28px;
  overflow: hidden;
  text-overflow: ellipsis;
}

${R} .sg-multi-select-option:hover,
${R} .sg-combobox-option-active {
  background-color: ${HOVER};
}

${R} .sg-combobox-option[aria-selected="true"]::before {
  content: "";
  position: absolute;
  left: 11px;
  top: 50%;
  width: 4px;
  height: 8px;
  border: solid ${ACCENT};
  border-width: 0 1.75px 1.75px 0;
  transform: translate(0, -60%) rotate(45deg);
}

${R} .sg-combobox-create {
  color: ${ACCENT};
}

${R} .sg-combobox-loading {
  padding: 2px 8px;
  color: ${MUTED};
  font-size: 12px;
}
`;

const SG_RULES_CSS = `${SG_DECORATION_CSS}${SG_BOOLEAN_CSS}${SG_HEADER_CSS}${SG_CONTROLS_CSS}${SG_FILTER_CSS}${SG_EDITOR_CSS}`;

/**
 * The remote-change flash. `@keyframes` cannot live inside the theme part
 * (AG Grid nests a part in a style rule, where `@keyframes` is invalid and
 * dropped), so `<SchemaGrid>` renders this in a plain `<style>` element.
 */
export const SG_KEYFRAMES_CSS = `
@keyframes sg-remote-flash {
  from {
    background-color: var(--sg-remote-flash-bg, rgba(22, 163, 74, 0.16));
  }
  to {
    background-color: transparent;
  }
}

@keyframes sg-menu-in {
  from {
    opacity: 0;
    transform: translateY(-2px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

@keyframes sg-readonly-hint {
  from {
    background-color: var(--sg-readonly-hint-bg, rgba(113, 113, 122, 0.16));
  }
  to {
    background-color: transparent;
  }
}
`;

/**
 * Raw CSS for all `SG_CLASSES`, every selector scoped under `.sg-root`, plus
 * the keyframes. Colors are `var(--sg-*, <fallback>)` so a host page can
 * theme us without a rebuild, falling back to sensible defaults otherwise.
 */
export const SG_CSS = `${SG_RULES_CSS}${SG_KEYFRAMES_CSS}`;

/**
 * The rules as injected through the Theming API part (`theme.ts`). AG Grid
 * wraps a part's CSS in the theme's scope class, which it puts on the grid's
 * own `ag-styled-root` element — *inside* `.sg-root` — so the `.sg-root`
 * ancestor is dropped here (a `.sg-root` below that scope never exists and
 * no rule would match). The theme scope already keeps this CSS off the rest
 * of the page.
 */
export const SG_THEME_CSS = SG_RULES_CSS.split(`.${SG_CLASSES.root} `).join("");
