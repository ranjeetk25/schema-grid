import { Badge, useMantineTheme } from "@mantine/core";
import { useLayoutEffect, useRef, useState } from "react";
import type { Option } from "../internal/core-contracts";
import type { UiRendererProps } from "../internal/grid-contracts";
import { getSelectOptions, resolveOptionColor } from "../internal/options";
import { CELL_BOX_STYLE } from "./CellBox";
import { CELL_BADGE_STYLES } from "./OptionBadge";

export interface MultiSelectRendererConfig {
  options?: Option[];
}

export interface MultiSelectRendererProps extends UiRendererProps<string[], MultiSelectRendererConfig> {
  /**
   * Most pills to show before collapsing the rest into "+N". When the cell
   * can be measured, fewer are shown if they do not fit on one line.
   * @default 2
   */
  limit?: number;
}

const GAP = 4;
/** Room kept for the "+N" badge while fitting pills. */
const OVERFLOW_BADGE_WIDTH = 30;

/** How many of the measured pill widths fit in `available` px on one line (at least 1). */
export function fitPillCount(widths: number[], available: number, cap: number): number {
  let used = 0;
  let count = 0;
  for (let i = 0; i < widths.length && count < cap; i++) {
    const w = (widths[i] ?? 0) + (i > 0 ? GAP : 0);
    const remaining = widths.length - (i + 1);
    const reserve = remaining > 0 ? GAP + OVERFLOW_BADGE_WIDTH : 0;
    if (used + w + reserve > available) break;
    used += w;
    count++;
  }
  return Math.max(1, count);
}

/**
 * One line of coloured pills, one per selected value, collapsing the rest
 * into a "+N" badge. Width-aware: a ResizeObserver measures the pills and
 * the cell and shows as many as fit (capped by `limit`); without layout
 * (SSR, tests) it shows `limit` pills.
 */
export function MultiSelectRenderer({ value, config, limit = 2 }: MultiSelectRendererProps) {
  const theme = useMantineTheme();
  const values = value ?? [];
  const containerRef = useRef<HTMLSpanElement>(null);
  const measureRef = useRef<HTMLSpanElement>(null);
  const [fit, setFit] = useState<number | null>(null);
  const key = values.join("\u0000");

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-measure when the values change
  useLayoutEffect(() => {
    const container = containerRef.current;
    const measure = measureRef.current;
    if (!container || !measure) return;
    const run = () => {
      const available = container.clientWidth;
      if (available <= 0) {
        setFit(null);
        return;
      }
      const widths = Array.from(measure.children, (c) => c.getBoundingClientRect().width);
      setFit(fitPillCount(widths, available, Math.max(1, limit)));
    };
    run();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(run);
    ro.observe(container);
    return () => ro.disconnect();
  }, [key, limit]);

  if (values.length === 0) return null;

  const options = getSelectOptions(config);
  const pills = values.map((v, i) => {
    const option = options.find((o) => o.id === v);
    const color = resolveOptionColor(option, theme);
    return (
      // biome-ignore lint/suspicious/noArrayIndexKey: values may repeat
      <Badge key={`${v}-${i}`} variant="light" radius="sm" color={color} styles={CELL_BADGE_STYLES}>
        {option?.label ?? v}
      </Badge>
    );
  });
  const shown = Math.min(values.length, fit ?? Math.max(1, limit));
  const overflow = values.length - shown;

  return (
    <span ref={containerRef} data-testid="multi-select-cell" style={{ ...CELL_BOX_STYLE, gap: GAP, position: "relative" }}>
      {pills.slice(0, shown)}
      {overflow > 0 && (
        <Badge
          variant="default"
          radius="sm"
          styles={{ root: { ...CELL_BADGE_STYLES.root, color: "var(--mantine-color-dimmed)", borderColor: "var(--mantine-color-default-border)" } }}
          aria-label={`${overflow} more`}
          title={values.slice(shown).map((v) => options.find((o) => o.id === v)?.label ?? v).join(", ")}
        >{`+${overflow}`}</Badge>
      )}
      {/* Off-screen copy of every pill, for measuring their natural widths. */}
      <span
        ref={measureRef}
        aria-hidden
        style={{ position: "absolute", visibility: "hidden", pointerEvents: "none", display: "flex", gap: GAP, left: 0, top: 0, whiteSpace: "nowrap" }}
      >
        {pills}
      </span>
    </span>
  );
}
