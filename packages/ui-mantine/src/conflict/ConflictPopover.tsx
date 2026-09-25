import { Box, Button, Group, Popover, Stack, Text } from "@mantine/core";
import type { ReactNode } from "react";
import type { ChangeConflict, ColumnDef, FieldTypeRegistry } from "../internal/core-contracts";
import type { ConflictResolution, UiFieldTypeRegistry } from "../internal/grid-contracts";
import { formatRelativeTime } from "../internal/relative-time";

export interface ConflictPopoverProps {
  conflict: ChangeConflict;
  column: ColumnDef;
  registry: FieldTypeRegistry;
  uiRegistry: UiFieldTypeRegistry;
  now?: Date | string | number;
  opened: boolean;
  onResolve(resolution: ConflictResolution): void;
  /** Escape / outside click: dismiss without resolving. */
  onClose?(): void;
  /** The cell anchor. */
  children: ReactNode;
}

/**
 * Anchored to the conflicting cell. `withinPortal={false}` keeps it inside
 * the grid's scroll container so it moves with the cell.
 */
export function ConflictPopover({
  conflict,
  column,
  registry,
  uiRegistry,
  now,
  opened,
  onResolve,
  onClose,
  children,
}: ConflictPopoverProps) {
  const who = conflict.updatedBy?.name ?? "someone";
  const when = formatRelativeTime(conflict.updatedAt, now ?? new Date());
  const Renderer = uiRegistry.get(column.type)?.renderer;
  const fieldType = registry.get(column.type);
  const theirs = Renderer ? (
    <Renderer value={conflict.serverValue} column={column} config={column.config} fieldType={column.type} />
  ) : (
    <Text size="sm">{fieldType ? fieldType.format(conflict.serverValue, column.config) : String(conflict.serverValue ?? "")}</Text>
  );

  return (
    <Popover
      opened={opened}
      onClose={onClose}
      onDismiss={onClose}
      withinPortal={false}
      closeOnEscape
      trapFocus={false}
      position="bottom"
      withArrow
      shadow="md"
    >
      <Popover.Target>
        <Box component="span" style={{ display: "inline-block" }}>
          {children}
        </Box>
      </Popover.Target>
      <Popover.Dropdown
        role="dialog"
        aria-label="Edit conflict"
      >
        <Stack gap="xs" maw={280}>
          <Text size="sm">{`Changed by ${who} ${when}:`}</Text>
          <Box>{theirs}</Box>
          <Group gap="xs" justify="flex-end">
            <Button size="xs" variant="default" onClick={() => onResolve("keepTheirs")}>
              Keep theirs
            </Button>
            <Button size="xs" color="orange" onClick={() => onResolve("overwrite")}>
              Overwrite
            </Button>
          </Group>
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
}
