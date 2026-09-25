import {
  AtSignIcon,
  CalendarClockIcon,
  CalendarIcon,
  CheckIcon,
  ChevronsUpDownIcon,
  CircleDotIcon,
  DollarSignIcon,
  HashIcon,
  LinkIcon,
  ListChecksIcon,
  type LucideIcon,
  PhoneIcon,
  PlusCircleIcon,
  SigmaIcon,
  SquareCheckIcon,
  TextIcon,
  TypeIcon,
  UserIcon,
  WaypointsIcon,
  XIcon,
} from "lucide-react";
import { type CSSProperties, type KeyboardEvent, type ReactNode, useEffect, useState } from "react";
import { cn } from "../lib/cn";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "../ui/command";
import { inputClasses } from "../ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";

/* Lane-local building blocks shared by the filter builder and the views bar. */

const TYPE_ICONS: Record<string, LucideIcon> = {
  text: TypeIcon,
  longText: TextIcon,
  number: HashIcon,
  currency: DollarSignIcon,
  select: CircleDotIcon,
  creatableSelect: PlusCircleIcon,
  multiSelect: ListChecksIcon,
  date: CalendarIcon,
  datetime: CalendarClockIcon,
  boolean: SquareCheckIcon,
  user: UserIcon,
  link: WaypointsIcon,
  url: LinkIcon,
  email: AtSignIcon,
  phone: PhoneIcon,
  formula: SigmaIcon,
};

/** 14px lucide glyph for a field type (unknown/custom types fall back to a text glyph). */
export function FieldTypeIcon({ type, className }: { type: string; className?: string }) {
  const Icon = TYPE_ICONS[type] ?? TypeIcon;
  return <Icon aria-hidden className={cn("sg:size-3.5 sg:shrink-0 sg:text-muted-foreground", className)} />;
}

export function ErrorText({ id, error }: { id?: string; error?: string }) {
  return error ? (
    <p id={id} className="sg:text-xs sg:leading-4 sg:text-danger">
      {error}
    </p>
  ) : null;
}

export interface PickerItem {
  value: string;
  label: string;
  /** Leading visual (type icon, option tone dot…). */
  icon?: ReactNode;
}

/** Tone dot for a select option; colours come from `optionToneStyle` via CSS variables. */
export function ToneDot({ style }: { style: CSSProperties }) {
  return <span aria-hidden style={style} className="sg:size-2 sg:shrink-0 sg:rounded-full sg:bg-[var(--sg-tone-dot)]" />;
}

// ---------------------------------------------------------------------------
// Single select (Radix Select) — short, fixed lists
// ---------------------------------------------------------------------------

export interface SelectFieldProps {
  "aria-label": string;
  placeholder?: string;
  items: readonly PickerItem[];
  value: string | null;
  onChange(value: string): void;
  disabled?: boolean;
  invalid?: boolean;
  describedBy?: string;
  className?: string;
  size?: "sm" | "md";
}

export function SelectField({ items, value, onChange, placeholder, disabled, invalid, describedBy, className, size, ...rest }: SelectFieldProps) {
  return (
    <Select value={value ?? ""} onValueChange={(v) => v && onChange(v)} disabled={disabled}>
      <SelectTrigger
        aria-label={rest["aria-label"]}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        size={size}
        className={className}
      >
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {items.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            {item.icon}
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// ---------------------------------------------------------------------------
// Searchable single picker (cmdk in a Popover) — column pickers
// ---------------------------------------------------------------------------

export interface ComboboxPickerProps {
  "aria-label": string;
  placeholder: string;
  searchPlaceholder?: string;
  emptyText?: string;
  items: readonly PickerItem[];
  value: string | null;
  onChange(value: string): void;
  /** Shown on the trigger when `value` is not among `items` (e.g. a column no longer offered); never listed. */
  selectedFallback?: PickerItem;
  disabled?: boolean;
  invalid?: boolean;
  describedBy?: string;
  className?: string;
  /** Replaces the trigger's leading visual/label (e.g. a "+ Group by" button). */
  trigger?: ReactNode;
  triggerVariant?: "secondary" | "ghost" | "subtle";
  size?: "sm" | "md";
}

export function ComboboxPicker({
  items,
  value,
  onChange,
  selectedFallback,
  placeholder,
  searchPlaceholder = "Search…",
  emptyText = "No matches",
  disabled,
  invalid,
  describedBy,
  className,
  trigger,
  triggerVariant = "secondary",
  size = "md",
  ...rest
}: ComboboxPickerProps) {
  const [open, setOpen] = useState(false);
  const selected = value
    ? (items.find((i) => i.value === value) ?? (selectedFallback?.value === value ? selectedFallback : undefined))
    : undefined;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild disabled={disabled}>
        <Button
          variant={triggerVariant}
          size={size === "sm" ? "sm" : "md"}
          // biome-ignore lint/a11y/useSemanticElements: WAI-ARIA combobox trigger for a cmdk listbox popover
          role="combobox"
          aria-label={rest["aria-label"]}
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          disabled={disabled}
          className={cn(
            "sg:justify-between sg:gap-2 sg:px-2.5 sg:font-normal",
            triggerVariant === "secondary" && "sg:aria-invalid:border-danger",
            className,
          )}
        >
          {trigger ?? (
            <>
              <span className="sg:flex sg:min-w-0 sg:items-center sg:gap-1.5">
                {selected?.icon}
                <span className={cn("sg:truncate", !selected && "sg:text-faint-foreground")}>{selected?.label ?? placeholder}</span>
              </span>
              <ChevronsUpDownIcon aria-hidden className="sg:size-3.5 sg:text-muted-foreground" />
            </>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="sg:w-60 sg:p-0">
        <Command>
          <CommandInput placeholder={searchPlaceholder} aria-label={searchPlaceholder} />
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            {items.map((item) => (
              <CommandItem
                key={item.value}
                value={item.value}
                keywords={[item.label]}
                onSelect={() => {
                  onChange(item.value);
                  setOpen(false);
                }}
              >
                {item.icon}
                <span className="sg:truncate">{item.label}</span>
                {item.value === value ? <CheckIcon aria-hidden className="sg:ml-auto sg:size-3.5 sg:text-primary" /> : null}
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// ---------------------------------------------------------------------------
// Multi picker (cmdk, stays open while toggling)
// ---------------------------------------------------------------------------

export interface MultiPickerProps {
  "aria-label": string;
  placeholder: string;
  items: readonly PickerItem[];
  value: readonly string[];
  onChange(value: string[]): void;
  invalid?: boolean;
  describedBy?: string;
  className?: string;
}

export function MultiPicker({ items, value, onChange, placeholder, invalid, describedBy, className, ...rest }: MultiPickerProps) {
  const [open, setOpen] = useState(false);
  const chosen = new Set(value);
  const labels = value.map((v) => items.find((i) => i.value === v)?.label ?? v);
  const toggle = (v: string) => onChange(chosen.has(v) ? value.filter((x) => x !== v) : [...value, v]);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="secondary"
          // biome-ignore lint/a11y/useSemanticElements: WAI-ARIA combobox trigger for a cmdk listbox popover
          role="combobox"
          aria-label={rest["aria-label"]}
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          className={cn("sg:w-full sg:justify-between sg:gap-2 sg:px-2 sg:font-normal sg:aria-invalid:border-danger", className)}
        >
          <span className="sg:flex sg:min-w-0 sg:items-center sg:gap-1">
            {labels.length === 0 ? <span className="sg:truncate sg:text-faint-foreground">{placeholder}</span> : null}
            {labels.slice(0, 2).map((l, i) => (
              <Badge key={`${i}:${l}`} variant="neutral" className="sg:max-w-28 sg:truncate sg:text-foreground">
                {l}
              </Badge>
            ))}
            {labels.length > 2 ? <span className="sg:text-xs sg:text-muted-foreground sg:tabular-nums">+{labels.length - 2}</span> : null}
          </span>
          <ChevronsUpDownIcon aria-hidden className="sg:size-3.5 sg:text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="sg:w-60 sg:p-0">
        <Command>
          <CommandInput placeholder="Search…" aria-label="Search values" />
          <CommandList aria-multiselectable>
            <CommandEmpty>No matches</CommandEmpty>
            {items.map((item) => {
              const on = chosen.has(item.value);
              return (
                <CommandItem key={item.value} value={item.value} keywords={[item.label]} data-checked={on} onSelect={() => toggle(item.value)}>
                  <span
                    aria-hidden
                    className={cn(
                      "sg:grid sg:size-4 sg:shrink-0 sg:place-content-center sg:rounded-sm sg:border sg:border-input-hover",
                      on && "sg:border-primary sg:bg-primary sg:text-primary-foreground",
                    )}
                  >
                    {on ? <CheckIcon className="sg:size-3" strokeWidth={3} /> : null}
                  </span>
                  {item.icon}
                  <span className="sg:truncate">{item.label}</span>
                </CommandItem>
              );
            })}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// ---------------------------------------------------------------------------
// Tags input (free-text multi values)
// ---------------------------------------------------------------------------

export interface TagsInputProps {
  "aria-label": string;
  placeholder?: string;
  value: readonly string[];
  onChange(value: string[]): void;
  invalid?: boolean;
  describedBy?: string;
}

export function TagsInput({ value, onChange, placeholder, invalid, describedBy, ...rest }: TagsInputProps) {
  const [text, setText] = useState("");
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      const t = text.trim();
      if (t && !value.includes(t)) onChange([...value, t]);
      setText("");
    } else if (e.key === "Backspace" && text === "" && value.length > 0) {
      onChange(value.slice(0, -1));
    }
  };
  return (
    <div
      className={cn(
        inputClasses,
        "sg:h-auto sg:min-h-8 sg:flex-wrap sg:items-center sg:gap-1 sg:px-1.5 sg:py-1 sg:focus-within:border-primary sg:focus-within:ring-[3px] sg:focus-within:ring-ring",
        invalid && "sg:border-danger",
      )}
    >
      {value.map((tag) => (
        <Badge key={tag} variant="neutral" className="sg:gap-0.5 sg:pr-0.5 sg:text-foreground">
          {tag}
          <button
            type="button"
            aria-label={`Remove ${tag}`}
            onClick={() => onChange(value.filter((t) => t !== tag))}
            className="sg:inline-flex sg:size-4 sg:items-center sg:justify-center sg:rounded-xs sg:text-muted-foreground sg:outline-none sg:hover:bg-background sg:hover:text-foreground sg:focus-visible:ring-2 sg:focus-visible:ring-ring"
          >
            <XIcon aria-hidden className="sg:size-3" />
          </button>
        </Badge>
      ))}
      <input
        aria-label={rest["aria-label"]}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        placeholder={value.length === 0 ? placeholder : undefined}
        value={text}
        onChange={(e) => setText(e.currentTarget.value)}
        onKeyDown={onKeyDown}
        className="sg:h-6 sg:min-w-16 sg:flex-1 sg:bg-transparent sg:px-1 sg:text-sm sg:outline-none sg:placeholder:text-faint-foreground"
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Number input that keeps partial text ("-", "1.") while typing
// ---------------------------------------------------------------------------

export const parseNumber = (text: string): number | null => {
  if (text.trim() === "") return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
};

export interface NumberFieldProps {
  "aria-label": string;
  placeholder?: string;
  value: number | null;
  onChange(value: number | null): void;
  integer?: boolean;
  min?: number;
  invalid?: boolean;
  describedBy?: string;
  className?: string;
}

export function NumberField({ value, onChange, placeholder, integer, min, invalid, describedBy, className, ...rest }: NumberFieldProps) {
  const [text, setText] = useState(value == null ? "" : String(value));
  useEffect(() => {
    setText((t) => (parseNumber(t) === value ? t : value == null ? "" : String(value)));
  }, [value]);
  return (
    <input
      type="text"
      inputMode={integer ? "numeric" : "decimal"}
      aria-label={rest["aria-label"]}
      aria-invalid={invalid || undefined}
      aria-describedby={describedBy}
      placeholder={placeholder}
      value={text}
      onChange={(e) => {
        const t = e.currentTarget.value;
        setText(t);
        let n = parseNumber(t);
        if (n !== null && integer) n = Math.trunc(n);
        if (n !== null && min !== undefined && n < min) n = null;
        onChange(n);
      }}
      className={cn(inputClasses, className)}
    />
  );
}
