/**
 * Shared chrome for the grid editors (popup card, picker rows, inline
 * validation). Injected once into the document head on first use: the
 * package ships no stylesheet, and these rules need `:hover` / attribute
 * selectors that inline styles cannot express. Everything reads Mantine CSS
 * variables, so both colour schemes follow the theme.
 */
const STYLE_ID = "sg-mantine-editor-css";

const CSS = `
.sg-ed-card {
  background: var(--mantine-color-body);
  color: var(--mantine-color-text);
  border: 1px solid var(--mantine-color-default-border);
  border-radius: var(--mantine-radius-lg, 8px);
  box-shadow: var(--mantine-shadow-md);
  padding: 4px;
  box-sizing: border-box;
  font-size: var(--mantine-font-size-sm, 13px);
}
[data-mantine-color-scheme="dark"] .sg-ed-card {
  box-shadow: var(--sg-popup-shadow-dark, 0 12px 32px -8px rgb(0 0 0 / 0.6));
}
/* ag-grid's popup wrapper already draws the card chrome: keep only the sizing. */
.sg-popup-editor > .sg-ed-card {
  background: none;
  border: 0;
  border-radius: 0;
  box-shadow: none;
  padding: 0;
  min-width: var(--sg-ed-width) !important;
}
.sg-ed-search {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  min-height: 32px;
  padding: 2px 8px;
  box-sizing: border-box;
  cursor: text;
}
.sg-ed-search > .sg-ed-search-icon {
  color: var(--mantine-color-dimmed);
  flex-shrink: 0;
  margin-right: 2px;
}
.sg-ed-input {
  flex: 1 1 96px;
  min-width: 96px;
  height: 28px;
  border: 0;
  outline: 0;
  padding: 0;
  margin: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: var(--mantine-font-size-sm, 13px);
}
.sg-ed-input::placeholder { color: var(--mantine-color-placeholder); opacity: 1; }
.sg-ed-input:disabled { cursor: progress; opacity: 0.6; }
.sg-ed-divider {
  height: 1px;
  background: var(--mantine-color-default-border);
  margin: 2px -4px 0;
}
.sg-ed-list {
  max-height: 264px;
  overflow-y: auto;
  padding-top: 4px;
}
.sg-ed-card .sg-ed-option {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 30px;
  padding: 0 8px;
  border-radius: var(--mantine-radius-sm, 6px);
  font-size: var(--mantine-font-size-sm, 13px);
  color: var(--mantine-color-text);
  background: transparent;
}
.sg-ed-card .sg-ed-option:hover,
.sg-ed-card .sg-ed-option[data-combobox-selected] {
  background: var(--mantine-color-default-hover);
  color: var(--mantine-color-text);
}
.sg-ed-card .sg-ed-option[data-combobox-disabled] { opacity: 0.5; }
.sg-ed-option-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sg-ed-check { flex-shrink: 0; color: var(--mantine-primary-color-filled); }
.sg-ed-dot {
  display: inline-block;
  flex-shrink: 0;
  width: 8px;
  height: 8px;
  border-radius: 50%;
}
.sg-ed-empty {
  padding: 8px;
  font-size: var(--mantine-font-size-xs, 12px);
  color: var(--mantine-color-dimmed);
}
.sg-ed-error {
  padding: 4px 8px 2px;
  font-size: var(--mantine-font-size-xs, 12px);
  line-height: 1.35;
  color: var(--mantine-color-error);
}
.sg-ed-hint {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 4px 4px 0;
  font-size: var(--mantine-font-size-xs, 12px);
  color: var(--mantine-color-dimmed);
}
.sg-ed-pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 100%;
  height: 22px;
  padding: 0 4px 0 8px;
  border-radius: var(--mantine-radius-xs, 4px);
  font-size: var(--mantine-font-size-xs, 12px);
  font-weight: 500;
  line-height: 1;
}
.sg-ed-pill > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sg-ed-pill > button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  padding: 0;
  border: 0;
  border-radius: 3px;
  background: transparent;
  color: inherit;
  opacity: 0.7;
  cursor: pointer;
}
.sg-ed-pill > button:hover { opacity: 1; background: rgb(0 0 0 / 0.08); }
/* Column panel */
.sg-cp-example, .sg-cp-fn {
  display: flex;
  flex-direction: column;
  gap: 1px;
  width: 100%;
  min-width: 0;
  padding: 6px 8px;
  border-radius: var(--mantine-radius-sm, 6px);
}
.sg-cp-example:hover, .sg-cp-fn:hover, .sg-cp-section-toggle:hover { background: var(--mantine-color-default-hover); }
.sg-cp-fade { animation: sg-cp-in 160ms ease-out; }
@keyframes sg-cp-in { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) { .sg-cp-fade { animation: none; } }
.sg-cp-section-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  width: calc(100% + 16px);
  margin: 0 -8px;
  padding: 6px 8px;
  border-radius: var(--mantine-radius-sm, 6px);
  font-size: var(--mantine-font-size-sm, 13px);
  font-weight: 500;
  color: var(--mantine-color-text);
}
.sg-cp-section-toggle > svg { color: var(--mantine-color-dimmed); transition: transform 120ms ease-out; }
.sg-cp-section-toggle[aria-expanded="true"] > svg { transform: rotate(90deg); }
.sg-cp-icon-btn:disabled, .sg-cp-icon-btn[data-disabled] { background: transparent !important; opacity: 0.35; }
.sg-cp-type-option {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 40px;
  padding: 4px 8px;
  border-radius: var(--mantine-radius-sm, 6px);
}
.sg-cp-type-option:hover, .sg-cp-type-option[data-combobox-selected] { background: var(--mantine-color-default-hover); color: inherit; }
.sg-cp-type-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 26px;
  height: 26px;
  border-radius: 6px;
  border: 1px solid var(--mantine-color-default-border);
  color: var(--mantine-color-dimmed);
  background: var(--mantine-color-body);
}
.sg-formula-glyph::before {
  content: "ƒ";
  font-family: Georgia, "Times New Roman", serif;
  font-style: italic;
  font-size: 12px;
  opacity: 0.75;
}
.sg-formula-glyph { flex-shrink: 0; }
.sg-ed-cell-input {
  width: 100%;
  height: 100%;
}
.sg-ed-cell-input[data-invalid] { box-shadow: inset 0 0 0 1px var(--mantine-color-error); border-radius: 2px; }
`;

/** Adds the shared editor stylesheet to `document.head` once. */
export function ensureEditorStyles(): void {
  if (typeof document === "undefined" || document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
}
