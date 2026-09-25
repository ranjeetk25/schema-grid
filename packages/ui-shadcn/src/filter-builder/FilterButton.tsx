import { ListFilterIcon } from "lucide-react";
import { useState } from "react";
import { SG_ROOT, cn } from "../lib/cn";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { FilterBuilderPanel, type FilterBuilderProps, useReportDraft } from "./FilterBuilder";
import { UnappliedDot } from "./FilterChips";
import { countConditions } from "./model";
import { useFilterApply } from "./useFilterApply";

export interface FilterButtonProps extends FilterBuilderProps {
  /** Button label. Default "Filter". */
  label?: string;
  /** Render the popover in place instead of portalling (e.g. inside an AG Grid popup). */
  portalled?: boolean;
  className?: string;
}

/**
 * A secondary "Filter" button with the applied-condition count that opens the
 * FilterBuilder in a Popover. The apply state lives here, so an unapplied
 * draft (explicit mode) survives closing the popover; the button then shows an
 * accent dot. Nested pickers are Radix layers in the popover's React tree, so
 * choosing an option never dismisses it.
 */
export function FilterButton({
  label = "Filter",
  portalled = true,
  className,
  value,
  onChange,
  mode,
  rowCount,
  liveFilterThreshold,
  debounceMs,
  onDraftChange,
  ...panel
}: FilterButtonProps) {
  const [open, setOpen] = useState(false);
  const apply = useFilterApply({ value, onApply: onChange, mode, rowCount, liveFilterThreshold, debounceMs });
  useReportDraft(apply, onDraftChange);
  const count = countConditions(value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="secondary" className={cn(SG_ROOT, className)} aria-haspopup="dialog">
          <ListFilterIcon aria-hidden className="sg:size-4 sg:text-muted-foreground" />
          {label}
          {count > 0 ? (
            <Badge variant="primary" data-testid="filter-count" className="sg:min-w-5 sg:justify-center sg:rounded-full sg:px-1.5">
              {count}
            </Badge>
          ) : null}
          {apply.dirty ? <UnappliedDot /> : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        portalled={portalled}
        aria-label={label}
        className="sg:w-[600px] sg:max-w-[calc(100vw-16px)] sg:p-0"
        onOpenAutoFocus={(e) => {
          // keep focus on the first control rather than the popover frame
          const first = (e.currentTarget as HTMLElement | null)?.querySelector<HTMLElement>("button, [href], input, [tabindex]:not([tabindex='-1'])");
          if (first) {
            e.preventDefault();
            first.focus();
          }
        }}
      >
        <FilterBuilderPanel {...panel} apply={apply} variant="popover" />
      </PopoverContent>
    </Popover>
  );
}
