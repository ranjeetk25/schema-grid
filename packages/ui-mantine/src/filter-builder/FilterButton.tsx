import { Badge, Button, Popover } from "@mantine/core";
import { useState } from "react";
import { FilterBuilder, type FilterBuilderProps } from "./FilterBuilder";
import { countConditions } from "./model";

export interface FilterButtonProps extends FilterBuilderProps {
  /** Button label. Default "Filter". */
  label?: string;
}

/**
 * A button with an active-condition count that opens the FilterBuilder in a
 * Popover. The popover and every inner dropdown render inline
 * (`withinPortal: false`), so picking an option counts as a click inside and
 * does not close the popover.
 */
export function FilterButton({ label = "Filter", ...builderProps }: FilterButtonProps) {
  const [opened, setOpened] = useState(false);
  const count = countConditions(builderProps.value);

  return (
    <Popover opened={opened} onChange={setOpened} withinPortal={false} position="bottom-start" shadow="md" trapFocus={false}>
      <Popover.Target>
        <Button
          variant="default"
          onClick={() => setOpened((o) => !o)}
          rightSection={
            count > 0 ? (
              <Badge size="sm" circle data-testid="filter-count">
                {count}
              </Badge>
            ) : undefined
          }
        >
          {label}
        </Button>
      </Popover.Target>
      <Popover.Dropdown miw={560}>
        <FilterBuilder {...builderProps} />
      </Popover.Dropdown>
    </Popover>
  );
}
