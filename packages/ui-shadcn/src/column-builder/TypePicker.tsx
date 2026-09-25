import { Check, ChevronsUpDown, Lock } from "lucide-react";
import { useId, useState } from "react";
import type { FieldTypeId, FieldTypeRegistry } from "../internal/core-contracts";
import { cn } from "../lib/cn";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "../ui/command";
import { inputClasses } from "../ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { Tooltip } from "../ui/tooltip";
import { fieldTypeMeta } from "./type-meta";

export interface TypePickerProps {
  registry: FieldTypeRegistry;
  value: FieldTypeId | null;
  onChange(type: FieldTypeId): void;
  /** Edit mode: the type cannot change. */
  locked?: boolean;
  error?: string;
  onBlur?(): void;
  /** Render the list in place (inside AG Grid popups). */
  portalled?: boolean;
}

/** Notion-style "Property type" picker: a trigger button + searchable list (icon, label, one-liner). */
export function TypePicker({ registry, value, onChange, locked = false, error, onBlur, portalled = true }: TypePickerProps) {
  const labelId = useId();
  const valueId = useId();
  const errorId = useId();
  const [open, setOpen] = useState(false);
  const current = value ? registry.get(value) : undefined;
  const meta = value ? fieldTypeMeta(value, current) : undefined;
  const Icon = meta?.icon;

  const trigger = (
    <button
      type="button"
      aria-labelledby={`${labelId} ${valueId}`}
      aria-describedby={error ? errorId : undefined}
      aria-invalid={error ? true : undefined}
      aria-haspopup="listbox"
      aria-expanded={open}
      disabled={locked}
      onBlur={() => {
        if (!open) onBlur?.();
      }}
      className={cn(inputClasses, "sg:h-9 sg:items-center sg:gap-2 sg:text-left sg:disabled:opacity-100 sg:disabled:bg-subtle")}
    >
      {Icon ? <Icon aria-hidden className="sg:size-4 sg:shrink-0 sg:text-muted-foreground" /> : null}
      <span id={valueId} className={cn("sg:flex-1 sg:truncate", !current && "sg:text-faint-foreground")}>
        {current?.label ?? "Pick a type…"}
      </span>
      {locked ? (
        <Lock aria-hidden className="sg:size-3.5 sg:shrink-0 sg:text-faint-foreground" />
      ) : (
        <ChevronsUpDown aria-hidden className="sg:size-3.5 sg:shrink-0 sg:text-faint-foreground" />
      )}
    </button>
  );

  return (
    <div className="sg:flex sg:flex-col sg:gap-1.5">
      <span id={labelId} className="sg:flex sg:items-center sg:gap-1 sg:text-sm sg:font-medium sg:text-foreground">
        Type
        {!locked ? (
          <span aria-hidden className="sg:text-danger">
            *
          </span>
        ) : null}
      </span>
      {locked ? (
        <Tooltip content="The type can't change after the column is created">
          <span className="sg:block">{trigger}</span>
        </Tooltip>
      ) : (
        <Popover
          open={open}
          onOpenChange={(next) => {
            setOpen(next);
            if (!next) onBlur?.();
          }}
        >
          <PopoverTrigger asChild>{trigger}</PopoverTrigger>
          <PopoverContent portalled={portalled} className="sg:w-[var(--radix-popover-trigger-width)] sg:min-w-72 sg:p-0" aria-label="Column types">
            <Command>
              <CommandInput placeholder="Search types…" />
              <CommandList className="sg:max-h-80">
                <CommandEmpty>No type matches</CommandEmpty>
                {registry.list().map((t) => {
                  const m = fieldTypeMeta(t.id, t);
                  const TypeIcon = m.icon;
                  const selected = t.id === value;
                  return (
                    <CommandItem
                      key={t.id}
                      value={t.id}
                      keywords={[t.label, m.description]}
                      onSelect={() => {
                        onChange(t.id);
                        setOpen(false);
                      }}
                      className="sg:items-start sg:gap-2.5 sg:py-1.5"
                    >
                      <TypeIcon aria-hidden className="sg:mt-0.5 sg:size-4 sg:shrink-0 sg:text-muted-foreground" />
                      <span className="sg:flex sg:min-w-0 sg:flex-1 sg:flex-col">
                        <span className="sg:text-sm sg:text-foreground">{t.label}</span>
                        <span className="sg:truncate sg:text-xs sg:text-muted-foreground">{m.description}</span>
                      </span>
                      {selected ? <Check aria-hidden className="sg:mt-0.5 sg:size-4 sg:shrink-0 sg:text-primary" /> : null}
                    </CommandItem>
                  );
                })}
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      )}
      {error ? (
        <p id={errorId} role="alert" className="sg:text-xs sg:text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
