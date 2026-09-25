import { type CSSProperties, type HTMLAttributes, forwardRef } from "react";

/** Vertically centred, single-line cell root shared by the Mantine renderers. */
export const CELL_BOX_STYLE: CSSProperties = {
  display: "flex",
  alignItems: "center",
  height: "100%",
  gap: 6,
  minWidth: 0,
  overflow: "hidden",
  whiteSpace: "nowrap",
};

/** A `span` with `CELL_BOX_STYLE` (forwards its ref, so it can be a Tooltip target). */
export const CellBox = forwardRef<HTMLSpanElement, HTMLAttributes<HTMLSpanElement> & { "data-testid"?: string }>(function CellBox(
  { style, ...rest },
  ref,
) {
  return <span ref={ref} {...rest} style={{ ...CELL_BOX_STYLE, ...style }} />;
});
