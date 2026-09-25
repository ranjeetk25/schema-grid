import type { ActorRef } from "../internal/core-contracts";
import { formatRelativeTime } from "../internal/relative-time";
import { SG_ROOT, cn } from "../lib/cn";
import { Tooltip } from "../ui/tooltip";

export interface RemoteChangedBadgeProps {
  updatedBy?: ActorRef;
  updatedAt: string;
  now?: Date | string | number;
  /** Dot colour (any CSS colour); defaults to the accent token. */
  color?: string;
  className?: string;
}

/** Tiny dot marking a cell a teammate changed; tooltip "Changed by X · 2 minutes ago". */
export function RemoteChangedBadge({ updatedBy, updatedAt, now, color, className }: RemoteChangedBadgeProps) {
  const label = `Changed by ${updatedBy?.name ?? "someone"} · ${formatRelativeTime(updatedAt, now ?? new Date())}`;
  return (
    <Tooltip content={label}>
      <span
        role="img"
        aria-label={label}
        // biome-ignore lint/a11y/noNoninteractiveTabindex: focusable so keyboard users can reach the tooltip
        tabIndex={0}
        className={cn(
          SG_ROOT,
          "sg:inline-block sg:size-2 sg:shrink-0 sg:rounded-full sg:bg-primary sg:ring-2 sg:ring-background sg:outline-none",
          "sg:focus-visible:ring-[3px] sg:focus-visible:ring-ring",
          className,
        )}
        style={color ? { backgroundColor: color } : undefined}
      />
    </Tooltip>
  );
}
