import { Box, Tooltip } from "@mantine/core";
import type { ActorRef } from "../internal/core-contracts";
import { formatRelativeTime } from "../internal/relative-time";

export interface RemoteChangedBadgeProps {
  updatedBy?: ActorRef;
  updatedAt: string;
  now?: Date | string | number;
  /** Dot colour (Mantine colour or CSS colour). Default: the accent (Mantine primary colour). */
  color?: string;
}

/** Tiny accent dot marking a cell a teammate changed; tooltip "Updated by X, 2 minutes ago". */
export function RemoteChangedBadge({ updatedBy, updatedAt, now, color }: RemoteChangedBadgeProps) {
  const label = `Updated by ${updatedBy?.name ?? "someone"}, ${formatRelativeTime(updatedAt, now ?? new Date())}`;
  return (
    <Tooltip label={label} withinPortal={false}>
      <Box
        component="span"
        role="img"
        aria-label={label}
        tabIndex={0}
        w={6}
        h={6}
        bg={color}
        display="inline-block"
        style={{
          borderRadius: "50%",
          background: color ? undefined : "var(--mantine-primary-color-filled)",
          boxShadow: "0 0 0 2px var(--mantine-color-body)",
          verticalAlign: "middle",
        }}
      />
    </Tooltip>
  );
}
