import { Badge, Box, Button, Loader, Popover } from "@mantine/core";
import { IconFilter } from "@tabler/icons-react";
import { useRef, useState } from "react";
import { FilterBuilder, type FilterBuilderHandle, type FilterBuilderProps, type FilterBuilderStatus } from "./FilterBuilder";
import { countConditions } from "./model";

export interface FilterButtonProps extends FilterBuilderProps {
  /** Button label. Default "Filter" (also the button's and the popover's accessible name). */
  label?: string;
  /** Popover width in px. Default 560. */
  width?: number;
}

const IDLE: FilterBuilderStatus = { mode: "live", pending: false, dirty: false, error: null };

/**
 * Toolbar button that opens the FilterBuilder in a popover.
 *
 * - The count badge shows the APPLIED conditions (`value`); while a live apply
 *   is debouncing / in flight it shows a tiny spinner instead.
 * - Explicit mode (large datasets, see `FilterBuilder`): a subtle accent dot
 *   marks unapplied changes.
 * - The popover stays mounted while closed (`keepMounted`) so an explicit-mode
 *   draft survives closing, and a pending live apply still lands.
 * - The popover and every inner dropdown render inline (`withinPortal: false`),
 *   so picking an option counts as a click inside and does not close it.
 */
export function FilterButton({ label = "Filter", width = 560, onStatusChange, ...builderProps }: FilterButtonProps) {
  const [opened, setOpened] = useState(false);
  const [status, setStatus] = useState<FilterBuilderStatus>(IDLE);
  const builderRef = useRef<FilterBuilderHandle>(null);
  const setOpen = (next: boolean) => {
    // Closing lands a debouncing live edit immediately (chips/grid update as the popover goes).
    if (!next) builderRef.current?.flush();
    setOpened(next);
  };
  const count = countConditions(builderProps.value);
  const active = count > 0;

  const badge = status.pending ? (
    <Badge size="sm" circle variant="light" data-testid="filter-count" aria-hidden styles={{ label: { display: "flex" } }}>
      <Loader size={8} color="var(--mantine-primary-color-filled)" type="oval" />
    </Badge>
  ) : active ? (
    <Badge size="sm" circle variant="light" data-testid="filter-count" aria-hidden style={{ fontVariantNumeric: "tabular-nums" }}>
      {count}
    </Badge>
  ) : null;

  return (
    <Popover
      opened={opened}
      onChange={setOpen}
      withinPortal={false}
      keepMounted
      position="bottom-start"
      offset={6}
      shadow="md"
      radius="lg"
      trapFocus={false}
    >
      <Popover.Target>
        <Button
          variant="subtle"
          color="gray"
          aria-label={label}
          aria-description={
            status.dirty ? "Unapplied filter changes" : active ? `${count} ${count === 1 ? "condition" : "conditions"} applied` : undefined
          }
          data-active={active || undefined}
          onClick={() => setOpen(!opened)}
          leftSection={<IconFilter size={16} stroke={1.75} aria-hidden />}
          rightSection={
            badge || status.dirty ? (
              <Box component="span" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                {badge}
                {status.dirty ? (
                  <Box
                    component="span"
                    data-testid="filter-unapplied-dot"
                    aria-hidden
                    w={6}
                    h={6}
                    style={{ borderRadius: "50%", background: "var(--mantine-primary-color-filled)" }}
                  />
                ) : null}
              </Box>
            ) : undefined
          }
          styles={{
            root: { color: active ? "var(--mantine-color-text)" : undefined, paddingInline: 10 },
            section: { marginInlineEnd: 6 },
          }}
        >
          {label}
        </Button>
      </Popover.Target>
      <Popover.Dropdown w={width} maw="calc(100vw - 32px)" p={12}>
        <FilterBuilder
          {...builderProps}
          ref={builderRef}
          autoFocus={opened}
          onStatusChange={(s) => {
            setStatus(s);
            onStatusChange?.(s);
          }}
        />
      </Popover.Dropdown>
    </Popover>
  );
}
