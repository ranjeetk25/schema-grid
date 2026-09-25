import { useLayoutEffect, useRef, useState } from "react";
import type { Option } from "../internal/core-contracts";
import type { UiRendererProps } from "../internal/grid-contracts";
import { getSelectOptions } from "../internal/options";
import { SG_ROOT, cn } from "../lib/cn";
import { Badge } from "../ui/badge";
import { OptionBadge } from "./OptionBadge";

export interface MultiSelectRendererConfig {
  options?: Option[];
}

export interface MultiSelectRendererProps extends UiRendererProps<string[], MultiSelectRendererConfig> {
  /** Upper bound on pills shown before collapsing the rest into "+N". @default 3 */
  limit?: number;
}

const GAP = 4;
/** Room kept for the "+N" chip when not everything fits. */
const OVERFLOW_CHIP = 30;

/**
 * One row of tone pills, clamped to the cell width: as many pills as fit
 * (measured with a ResizeObserver, never more than `limit`), then "+N". The
 * row never wraps. Without layout (SSR / jsdom) it falls back to `limit`.
 */
export function MultiSelectRenderer({ value, config, limit = 3 }: MultiSelectRendererProps) {
  const values = value ?? [];
  const options = getSelectOptions(config);
  const candidates = values.slice(0, limit);
  const rowRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(candidates.length);
  const key = `${values.join("\u0000")}|${limit}`;

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-measure when the values or limit change.
  useLayoutEffect(() => {
    const row = rowRef.current;
    const measure = measureRef.current;
    if (!row || !measure) return;
    const compute = () => {
      const available = row.clientWidth;
      const widths = Array.from(measure.children, (el) => (el as HTMLElement).offsetWidth);
      if (available <= 0 || widths.every((w) => w === 0)) {
        setFit(candidates.length);
        return;
      }
      let used = 0;
      let count = 0;
      for (const width of widths) {
        const withPill = used + (count > 0 ? GAP : 0) + width;
        const hiddenAfter = values.length - (count + 1);
        if (withPill + (hiddenAfter > 0 ? GAP + OVERFLOW_CHIP : 0) > available) break;
        used = withPill;
        count++;
      }
      setFit(Math.max(count, Math.min(1, candidates.length)));
    };
    compute();
    const observer = new ResizeObserver(compute);
    observer.observe(row);
    return () => observer.disconnect();
  }, [key]);

  if (values.length === 0) return null;

  const pill = (v: string, i: number) => {
    const option = options.find((o) => o.id === v) ?? { id: v, label: v };
    return <OptionBadge key={`${v}-${i}`} option={option} className={i === 0 ? "sg:min-w-0 sg:shrink" : "sg:shrink-0"} />;
  };
  const visible = candidates.slice(0, Math.min(fit, candidates.length));
  const overflow = values.length - visible.length;

  return (
    <div
      ref={rowRef}
      data-slot="multi-select-renderer"
      className={cn(SG_ROOT, "sg:relative sg:flex sg:h-full sg:min-w-0 sg:cursor-default sg:items-center sg:gap-1 sg:overflow-hidden sg:whitespace-nowrap")}
    >
      <div ref={measureRef} aria-hidden className="sg:pointer-events-none sg:invisible sg:absolute sg:top-0 sg:left-0 sg:flex sg:gap-1">
        {candidates.map(pill)}
      </div>
      {visible.map(pill)}
      {overflow > 0 ? (
        <Badge variant="neutral" className="sg:shrink-0" title={values.slice(visible.length).map((v) => options.find((o) => o.id === v)?.label ?? v).join(", ")}>
          {`+${overflow}`}
        </Badge>
      ) : null}
    </div>
  );
}
