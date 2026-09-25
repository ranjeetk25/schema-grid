import { CheckIcon, ChevronsUpDownIcon } from "lucide-react";
import { type CSSProperties, type ComponentProps, type ReactNode, forwardRef } from "react";
import type { Option } from "../internal/core-contracts";
import { optionToneStyle } from "../internal/options";
import { SG_ROOT, cn } from "../lib/cn";
import { inputClasses } from "../ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";

/**
 * Popup editor chrome: an opaque floating card (popover fill, 8px radius,
 * hairline + soft elevation) that is never narrower than the edited cell.
 * AG Grid renders popup editors into its own popup layer (`popupParent`), so
 * the card and everything in it (lists, calendars) render inline — no nested
 * portals, nothing to clip.
 */
export const EditorCard = forwardRef<HTMLDivElement, ComponentProps<"div"> & { cellWidth?: number }>(function EditorCard(
  { cellWidth, className, style, ...props },
  ref,
) {
  return (
    <div
      ref={ref}
      data-slot="editor-card"
      className={cn(
        SG_ROOT,
        "sg-popup-card sg:flex sg:flex-col sg:overflow-hidden sg:rounded-lg sg:bg-popover sg:text-foreground sg:shadow-popover sg:outline-none",
        className,
      )}
      style={{ minWidth: `max(240px, ${Math.max(0, Math.round(cellWidth ?? 0))}px)`, ...style }}
      {...props}
    />
  );
});

/** Muted one-line keyboard hint row at the bottom of a card ("⌘↵ save · esc cancel"). */
export function CardHint({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "sg:flex sg:h-7 sg:shrink-0 sg:items-center sg:justify-end sg:gap-2 sg:border-t sg:border-border sg:bg-subtle sg:px-2.5 sg:font-mono sg:text-2xs sg:text-faint-foreground",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Danger helper text under a control (validation after touch / commit attempt). */
export function FieldMessage({ id, children, tone = "danger" }: { id?: string; children: ReactNode; tone?: "danger" | "muted" }) {
  if (children == null || children === "") return null;
  return (
    <p
      id={id}
      role={tone === "danger" ? "alert" : undefined}
      className={cn("sg:text-xs sg:leading-4", tone === "danger" ? "sg:text-danger" : "sg:text-muted-foreground")}
    >
      {children}
    </p>
  );
}

/** 8px option-tone dot. `data-color` carries the resolved tone for tests / theming hooks. */
export function ToneDot({ option, className }: { option: Option | { color?: string } | undefined; className?: string }) {
  return (
    <span
      aria-hidden
      data-testid="option-color-dot"
      data-color={option?.color ?? "gray"}
      style={optionToneStyle(option)}
      className={cn("sg:inline-block sg:size-2 sg:shrink-0 sg:rounded-full sg:bg-[var(--sg-tone-dot)]", className)}
    />
  );
}

/** Option row body: tone dot, label, and a primary check mark when selected. */
export function OptionRowContent({ option, selected, dot = true }: { option: Option; selected?: boolean; dot?: boolean }) {
  return (
    <>
      {dot ? <ToneDot option={option} /> : null}
      <span className="sg:min-w-0 sg:flex-1 sg:truncate">{option.label}</span>
      <CheckIcon aria-hidden className={cn("sg:size-3.5 sg:shrink-0 sg:text-primary", selected ? "sg:opacity-100" : "sg:opacity-0")} />
    </>
  );
}

/** In-cell (inline) grid editor input: fills the cell, no chrome — the grid draws the focus frame. */
export const gridInputClasses = cn(
  "sg:block sg:h-full sg:w-full sg:min-w-0 sg:border-0 sg:bg-background sg:px-2 sg:text-sm sg:text-foreground sg:outline-none sg:tabular-nums",
  "sg:placeholder:text-faint-foreground sg:aria-invalid:shadow-[inset_0_0_0_1px_var(--sg-ui-danger)]",
);

export { inputClasses };

export interface FormPickerProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  /** Accessible name of the trigger (usually the column label). */
  label?: string;
  /** Trigger body; `placeholder` is shown when it is empty. */
  display?: ReactNode;
  placeholder?: string;
  error?: string;
  disabled?: boolean;
  /** Leading icon inside the trigger. */
  icon?: ReactNode;
  /** Popover content width; defaults to the trigger width (min 240px). */
  contentClassName?: string;
  contentStyle?: CSSProperties;
  children: ReactNode;
}

/**
 * Form / filter mode (`autoFocus === false`): a compact 32px trigger that
 * opens a portalled popover holding the same list the grid card shows inline.
 */
export function FormPicker({
  open,
  onOpenChange,
  label,
  display,
  placeholder = "Select…",
  error,
  disabled,
  icon,
  contentClassName,
  contentStyle,
  children,
}: FormPickerProps) {
  const empty = display == null || display === "" || display === false;
  return (
    <div className={cn(SG_ROOT, "sg:flex sg:w-full sg:min-w-0 sg:flex-col sg:gap-1")}>
      <Popover open={open} onOpenChange={onOpenChange}>
        <PopoverTrigger asChild disabled={disabled}>
          <button
            type="button"
            // biome-ignore lint/a11y/useSemanticElements: a combobox trigger opening a popover list, not a native select.
            // biome-ignore lint/a11y/useAriaPropsForRole: Radix's PopoverTrigger adds aria-controls at runtime.
            role="combobox"
            aria-haspopup="listbox"
            aria-expanded={open}
            aria-label={label}
            aria-invalid={error ? true : undefined}
            className={cn(
              inputClasses,
              "sg:cursor-default sg:items-center sg:gap-2 sg:pr-2 sg:text-left",
              "sg:data-[state=open]:border-primary sg:data-[state=open]:ring-[3px] sg:data-[state=open]:ring-ring",
            )}
          >
            {icon}
            <span className={cn("sg:flex sg:min-w-0 sg:flex-1 sg:items-center sg:gap-1.5 sg:truncate", empty && "sg:text-faint-foreground")}>
              {empty ? placeholder : display}
            </span>
            <ChevronsUpDownIcon aria-hidden className="sg:size-3.5 sg:shrink-0 sg:text-faint-foreground" />
          </button>
        </PopoverTrigger>
        <PopoverContent
          className={cn("sg:flex sg:w-[max(240px,var(--radix-popover-trigger-width))] sg:flex-col sg:overflow-hidden sg:p-0", contentClassName)}
          style={contentStyle}
          onOpenAutoFocus={(event) => {
            // Focus the list's search input (if any) rather than the first focusable.
            const input = (event.currentTarget as HTMLElement | null)?.querySelector<HTMLElement>("[cmdk-input], input, textarea");
            if (input) {
              event.preventDefault();
              input.focus();
            }
          }}
        >
          {children}
        </PopoverContent>
      </Popover>
      <FieldMessage>{error}</FieldMessage>
    </div>
  );
}
