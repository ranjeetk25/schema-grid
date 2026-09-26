/**
 * Toolbar "Columns" button (v0.3, shadcn skin): a popover to show / hide and
 * reorder the listable columns of the current view. Pure model in `./columnPicker`.
 */
import { ChevronDownIcon, ChevronUpIcon, Columns3Icon, SearchIcon } from "lucide-react";
import { useId, useState } from "react";
import { FieldTypeIcon } from "../filter-builder/pickers";
import { cn } from "../lib/cn";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Input } from "../ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { Tooltip } from "../ui/tooltip";
import {
  type ColumnPickerItem,
  filterPickerColumns,
  hiddenCount,
  movePickerColumn,
  setAllPickerColumns,
  togglePickerColumn,
} from "./columnPicker";

export interface ColumnsButtonProps {
  items: ColumnPickerItem[];
  onChange(items: ColumnPickerItem[]): void;
}

export function ColumnsButton({ items, onChange }: ColumnsButtonProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const id = useId();
  const hidden = hiddenCount(items);
  const visible = filterPickerColumns(items, search);
  const label = hidden > 0 ? `Columns (${hidden} hidden)` : "Columns";
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip content="Columns">
        <PopoverTrigger asChild>
          <Button
            variant="subtle"
            size="icon"
            aria-label={label}
            aria-expanded={open}
            data-testid="columns-button"
            className="sg:relative"
          >
            <Columns3Icon />
            {hidden > 0 ? (
              <span
                data-testid="columns-hidden-count"
                className="sg:pointer-events-none sg:absolute sg:top-0 sg:right-0 sg:inline-flex sg:h-3.5 sg:min-w-3.5 sg:items-center sg:justify-center sg:rounded-full sg:bg-muted sg:px-1 sg:text-[10px] sg:font-medium sg:text-muted-foreground sg:tabular-nums"
              >
                {hidden}
              </span>
            ) : null}
          </Button>
        </PopoverTrigger>
      </Tooltip>
      <PopoverContent align="end" className="sg:w-[300px] sg:p-2" aria-label="Columns">
        <div className="sg:relative sg:mb-1.5">
          <SearchIcon aria-hidden className="sg:pointer-events-none sg:absolute sg:top-1/2 sg:left-2.5 sg:size-3.5 sg:-translate-y-1/2 sg:text-muted-foreground" />
          <Input
            aria-label="Search columns"
            placeholder="Search columns"
            value={search}
            className="sg:h-7 sg:pl-8 sg:text-xs"
            onChange={(e) => setSearch(e.currentTarget.value)}
          />
        </div>
        <div className="sg:mb-1 sg:flex sg:items-center sg:justify-between sg:px-1">
          <span className="sg:text-xs sg:text-muted-foreground" data-testid="columns-summary">
            {hidden > 0 ? `${hidden} hidden` : "All columns shown"}
          </span>
          <div className="sg:flex sg:items-center sg:gap-1">
            <Button variant="subtle" size="xs" onClick={() => onChange(setAllPickerColumns(items, true))} disabled={hidden === 0}>
              Show all
            </Button>
            <Button variant="subtle" size="xs" onClick={() => onChange(setAllPickerColumns(items, false))} disabled={hidden === items.length}>
              Hide all
            </Button>
          </div>
        </div>
        <ul aria-label="Column list" className="sg:m-0 sg:max-h-80 sg:list-none sg:overflow-y-auto sg:p-0">
          {visible.map((item) => {
            const index = items.findIndex((i) => i.id === item.id);
            const checkboxId = `${id}-${item.id}`;
            return (
              <li key={item.id} className="sg-columns-row sg:flex sg:h-7.5 sg:items-center sg:gap-1.5 sg:rounded-md sg:px-1 sg:hover:bg-muted">
                <Checkbox
                  id={checkboxId}
                  checked={item.visible}
                  aria-label={item.label}
                  onCheckedChange={() => onChange(togglePickerColumn(items, item.id))}
                />
                <label htmlFor={checkboxId} className="sg:flex sg:min-w-0 sg:flex-1 sg:cursor-pointer sg:items-center sg:gap-1.5 sg:text-sm">
                  <span className="sg:inline-flex sg:text-muted-foreground sg:[&_svg]:size-3.5">
                    <FieldTypeIcon type={item.type} />
                  </span>
                  <span className="sg:truncate">{item.label}</span>
                </label>
                <div className="sg:flex sg:shrink-0 sg:items-center">
                  <Button
                    variant="subtle"
                    size="icon-xs"
                    aria-label={`Move ${item.label} up`}
                    disabled={index <= 0}
                    onClick={() => onChange(movePickerColumn(items, item.id, -1))}
                  >
                    <ChevronUpIcon />
                  </Button>
                  <Button
                    variant="subtle"
                    size="icon-xs"
                    aria-label={`Move ${item.label} down`}
                    disabled={index === -1 || index >= items.length - 1}
                    onClick={() => onChange(movePickerColumn(items, item.id, 1))}
                  >
                    <ChevronDownIcon />
                  </Button>
                </div>
              </li>
            );
          })}
          {visible.length === 0 ? <li className={cn("sg:py-3 sg:text-center sg:text-xs sg:text-muted-foreground")}>No matching columns</li> : null}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
