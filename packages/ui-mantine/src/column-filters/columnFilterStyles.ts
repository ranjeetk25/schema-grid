/**
 * Scoped styles for the Mantine column filters (rendered as a <style> element
 * by each filter; ui-mantine ships no CSS file).
 */
export const COLUMN_FILTER_CSS = `
.sg-cf { width: 256px; font-size: 13px; color: var(--mantine-color-text); }
.sg-cf .sg-cf-header { min-height: 16px; }
.sg-cf .sg-cf-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 12px;
  border-top: 1px solid var(--mantine-color-default-border);
}
.sg-cf .sg-cf-footer-text { font-size: 12px; color: var(--mantine-color-dimmed); font-variant-numeric: tabular-nums; }
.sg-cf .sg-cf-links { display: flex; align-items: center; gap: 2px; }
.sg-cf .sg-cf-list { padding: 0 4px 4px; }
.sg-cf .sg-cf-option {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 28px;
  padding: 0 8px;
  border-radius: 6px;
  cursor: pointer;
  user-select: none;
}
.sg-cf .sg-cf-option:hover { background: var(--mantine-color-default-hover); }
.sg-cf .sg-cf-option .mantine-Checkbox-root { display: inline-flex; }
.sg-cf .sg-cf-dot { width: 8px; height: 8px; border-radius: 50%; flex: none; }
.sg-cf .sg-cf-option-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sg-cf .sg-cf-empty { padding: 8px 12px 12px; font-size: 12px; color: var(--mantine-color-dimmed); }
`;
