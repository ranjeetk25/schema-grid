/**
 * Class name constants and raw CSS for our own cell/row decorations
 * (range selection, pending/error/remote-changed cells, the fill handle,
 * group rows, "load more" rows, and rows scrolled out of view).
 *
 * Every selector below is scoped under `.sg-root` (the class the grid's
 * wrapping element carries) so this CSS never leaks onto the rest of the
 * host page. `theme.ts` injects it via the Theming API's `createPart`
 * `css` option; `SG_CSS` is also exported raw so a consumer that can't use
 * the Theming part mechanism can ship it as a stylesheet instead.
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
} as const;

export type SgClassName = (typeof SG_CLASSES)[keyof typeof SG_CLASSES];

/**
 * Raw CSS for all `SG_CLASSES`, every selector scoped under `.sg-root`.
 * Colors are `var(--sg-*, <fallback>)` so a host page can theme us without
 * a rebuild, falling back to sensible defaults otherwise.
 */
export const SG_CSS = `
.${SG_CLASSES.root} .${SG_CLASSES.range} {
  background-color: var(--sg-range-bg, rgba(33, 133, 208, 0.12));
}

.${SG_CLASSES.root} .${SG_CLASSES.rangeTop} {
  border-top: 1px solid var(--sg-range-border, #2185d0);
}

.${SG_CLASSES.root} .${SG_CLASSES.rangeRight} {
  border-right: 1px solid var(--sg-range-border, #2185d0);
}

.${SG_CLASSES.root} .${SG_CLASSES.rangeBottom} {
  border-bottom: 1px solid var(--sg-range-border, #2185d0);
}

.${SG_CLASSES.root} .${SG_CLASSES.rangeLeft} {
  border-left: 1px solid var(--sg-range-border, #2185d0);
}

.${SG_CLASSES.root} .${SG_CLASSES.pending} {
  background-color: var(--sg-pending-bg, rgba(251, 189, 8, 0.15));
}

.${SG_CLASSES.root} .${SG_CLASSES.error} {
  background-color: var(--sg-error-bg, rgba(219, 40, 40, 0.12));
  outline: 1px solid var(--sg-error-border, #db2828);
  outline-offset: -1px;
}

.${SG_CLASSES.root} .${SG_CLASSES.remoteChanged} {
  animation: sg-remote-flash var(--sg-remote-flash-duration, 1.2s) ease-out;
}

.${SG_CLASSES.root} .${SG_CLASSES.notInView} {
  opacity: var(--sg-not-in-view-opacity, 0.55);
}

.${SG_CLASSES.root} .${SG_CLASSES.fillHandle} {
  position: absolute;
  width: var(--sg-fill-handle-size, 6px);
  height: var(--sg-fill-handle-size, 6px);
  right: -3px;
  bottom: -3px;
  background-color: var(--sg-range-border, #2185d0);
  border: 1px solid var(--sg-fill-handle-border, #ffffff);
  cursor: crosshair;
}

.${SG_CLASSES.root} .${SG_CLASSES.fillPreview} {
  background-color: var(--sg-fill-preview-bg, rgba(33, 133, 208, 0.08));
  outline: 1px dashed var(--sg-range-border, #2185d0);
  outline-offset: -1px;
}

.${SG_CLASSES.root} .${SG_CLASSES.groupRow} {
  background-color: var(--sg-group-row-bg, rgba(0, 0, 0, 0.03));
  font-weight: 600;
}

.${SG_CLASSES.root} .${SG_CLASSES.loadMoreRow} {
  color: var(--sg-load-more-color, #767676);
  cursor: pointer;
  text-align: center;
}

@keyframes sg-remote-flash {
  from {
    background-color: var(--sg-remote-flash-bg, rgba(33, 186, 69, 0.35));
  }
  to {
    background-color: transparent;
  }
}
`;
