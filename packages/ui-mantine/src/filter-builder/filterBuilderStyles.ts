/**
 * Scoped styles for the filter builder's inline "pill" controls. Rendered as
 * a <style> element by the builder (ui-mantine ships no CSS file). Custom
 * properties use `!important` so they beat the per-size inline variables the
 * Mantine theme puts on every input wrapper (including registry editor
 * widgets rendered as value inputs).
 */
export const FILTER_BUILDER_CSS = `
.sg-fb {
  --sg-fb-fill: #f4f4f5;
  --sg-fb-fill-hover: #ececef;
  --sg-fb-lead: var(--mantine-color-dimmed);
  --sg-fb-hairline: var(--mantine-color-default-border);
  font-size: 13px;
}
[data-mantine-color-scheme="dark"] .sg-fb {
  --sg-fb-fill: #26262b;
  --sg-fb-fill-hover: #2e2e33;
}
.sg-fb .sg-fb-row {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  min-width: 0;
}
.sg-fb .sg-fb-lead {
  flex: none;
  width: 60px;
  min-height: 28px;
  display: flex;
  align-items: center;
  color: var(--sg-fb-lead);
  font-size: 13px;
}
.sg-fb .sg-fb-value { flex: 1 1 auto; min-width: 0; }
.sg-fb .sg-fb-row .mantine-Input-wrapper,
.sg-fb .sg-fb-row .mantine-InputWrapper-root {
  --input-height: 28px !important;
  --input-fz: 13px !important;
  --input-radius: 6px !important;
}
.sg-fb .sg-fb-row .mantine-Input-input {
  background: var(--sg-fb-fill);
  border-color: transparent;
  transition: background-color 120ms ease-out, border-color 120ms ease-out;
}
.sg-fb .sg-fb-row .mantine-Input-input:hover { background: var(--sg-fb-fill-hover); }
.sg-fb .sg-fb-row .mantine-Input-input:focus,
.sg-fb .sg-fb-row .mantine-Input-input:focus-within,
.sg-fb .sg-fb-row .mantine-Input-input[data-expanded] {
  border-color: var(--mantine-primary-color-filled);
  background: var(--mantine-color-body);
}
.sg-fb .sg-fb-row .mantine-Input-input[data-error] { border-color: var(--mantine-color-error); }
.sg-fb .sg-fb-row .mantine-Input-input:disabled { background: transparent; border: 1px dashed var(--sg-fb-hairline); }
.sg-fb .sg-fb-row .mantine-Input-section { color: var(--mantine-color-dimmed); }
.sg-fb .sg-fb-row .mantine-PillsInput-input { min-height: 28px; }
.sg-fb .sg-fb-row .mantine-Pill-root { --pill-height: 20px; font-size: 12px; }
.sg-fb .sg-fb-group {
  border: 1px solid var(--sg-fb-hairline);
  border-radius: 8px;
  padding: 8px;
}
.sg-fb .sg-fb-footer {
  border-top: 1px solid var(--sg-fb-hairline);
  margin: 4px -12px -4px;
  padding: 8px 12px 0;
}
.sg-fb .sg-fb-empty { padding: 4px 0 2px; font-size: 13px; color: var(--mantine-color-dimmed); }
`;
