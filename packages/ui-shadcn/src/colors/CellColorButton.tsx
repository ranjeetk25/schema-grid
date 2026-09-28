import { PaintBucketIcon } from "lucide-react";
import { useEffect, useState } from "react";
import type { CellColor } from "../internal/core-contracts";
import type { SchemaGridHandle } from "../internal/grid-contracts";
import { SG_ROOT, cn } from "../lib/cn";
import { Button } from "../ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { Tooltip } from "../ui/tooltip";
import { CellColorPicker } from "./CellColorPicker";

/** The part of `SchemaGridHandle` painting needs. */
export type CellColorPaintHandle = Pick<SchemaGridHandle, "canPaint" | "setCellColor" | "api"> & {
  stores: Pick<SchemaGridHandle["stores"], "range" | "rows">;
};

type GridApiLike = {
  isDestroyed(): boolean;
  addEventListener(type: "cellFocused", fn: () => void): void;
  removeEventListener(type: "cellFocused", fn: () => void): void;
};

/**
 * `handle.canPaint()`, kept current: re-read when the range selection or the
 * rows change and when grid focus moves (`cellFocused`, attached once the
 * grid API exists).
 */
export function useCanPaint(handle: CellColorPaintHandle | null): boolean {
  const [can, setCan] = useState(() => handle?.canPaint() ?? false);
  useEffect(() => {
    if (!handle) {
      setCan(false);
      return;
    }
    let api: GridApiLike | null = null;
    const update = () => {
      setCan(handle.canPaint());
      if (api) return;
      const next = handle.api() as unknown as GridApiLike | null;
      if (next && !next.isDestroyed()) {
        api = next;
        next.addEventListener("cellFocused", update);
      }
    };
    update();
    const unsubscribe = [handle.stores.range.subscribe(update), handle.stores.rows.subscribe(update)];
    return () => {
      for (const off of unsubscribe) off();
      const current = api as GridApiLike | null;
      if (current && !current.isDestroyed()) current.removeEventListener("cellFocused", update);
    };
  }, [handle]);
  return can;
}

export interface CellColorButtonProps {
  handle: CellColorPaintHandle | null;
  /** A paint the source failed (the grid rolled it back). Skipped cells arrive through `SchemaGrid.onCellColorReport`. */
  onError?(error: unknown): void;
  className?: string;
}

/**
 * v0.4 toolbar "Cell color": a 32px ghost icon button opening the palette
 * (swatches + "No color"). Picking paints the range selection (else the
 * focused cell) through `handle.setCellColor` and closes. Unavailable
 * (`aria-disabled`, tooltip says why) until `handle.canPaint()`.
 */
export function CellColorButton({ handle, onError, className }: CellColorButtonProps) {
  const canPaint = useCanPaint(handle);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!canPaint) setOpen(false);
  }, [canPaint]);

  const pick = (color: CellColor | null) => {
    setOpen(false);
    handle?.setCellColor(color).catch((error: unknown) => onError?.(error));
  };

  return (
    <Popover open={open} onOpenChange={(next) => setOpen(next && canPaint)}>
      <Tooltip content={canPaint ? "Cell color" : "Cell color: select cells you can edit"}>
        <PopoverTrigger asChild>
          <Button
            variant="subtle"
            size="icon"
            aria-label="Cell color"
            aria-haspopup="dialog"
            aria-disabled={canPaint ? undefined : true}
            className={cn(SG_ROOT, !canPaint && "sg:opacity-40 sg:hover:bg-transparent sg:hover:text-muted-foreground", className)}
          >
            <PaintBucketIcon />
          </Button>
        </PopoverTrigger>
      </Tooltip>
      <PopoverContent aria-label="Cell color" align="end" className="sg:w-auto sg:p-2">
        <p className="sg:mb-2 sg:px-0.5 sg:text-xs sg:font-medium sg:text-muted-foreground">Cell color</p>
        <CellColorPicker onPick={pick} />
      </PopoverContent>
    </Popover>
  );
}
