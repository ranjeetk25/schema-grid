import { Box, Tooltip } from "@mantine/core";
import type { ActorRef } from "../internal/core-contracts";
import { formatRelativeTime } from "../internal/relative-time";

export interface RemoteChangedBadgeProps {
  updatedBy?: ActorRef;
  updatedAt: string;
  now?: Date | string | number;
  color?: string;
}

/** Small dot marking a cell a teammate changed; tooltip "Updated by X, 2 minutes ago". */
export function RemoteChangedBadge({ updatedBy, updatedAt, now, color = "blue" }: RemoteChangedBadgeProps) {
  const label = `Updated by ${updatedBy?.name ?? "someone"}, ${formatRelativeTime(updatedAt, now ?? new Date())}`;
  return (
    <Tooltip label={label} withinPortal={false} withArrow>
      <Box
        component="span"
        role="img"
        aria-label={label}
        tabIndex={0}
        w={8}
        h={8}
        bg={color}
        display="inline-block"
        style={{ borderRadius: "50%" }}
      />
    </Tooltip>
  );
}
