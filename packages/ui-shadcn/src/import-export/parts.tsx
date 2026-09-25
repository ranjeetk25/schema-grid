/**
 * Lane-local building blocks shared by the import wizard and export dialog:
 * a radiogroup (segmented or card layout), an inline alert and a spinner.
 */
import { CircleAlertIcon, LoaderCircleIcon } from "lucide-react";
import { type KeyboardEvent, type ReactNode, useRef } from "react";
import { cn } from "../lib/cn";

export interface ChoiceOption<T extends string> {
  value: T;
  label: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  disabled?: boolean;
}

export interface ChoiceGroupProps<T extends string> {
  /** Accessible name of the radiogroup. */
  label: string;
  value: T;
  options: ChoiceOption<T>[];
  onChange(value: T): void;
  disabled?: boolean;
  /** `segmented`: compact pill control. `cards`: one selectable card per option. */
  variant?: "segmented" | "cards";
  className?: string;
}

const NEXT_KEYS = new Set(["ArrowRight", "ArrowDown"]);
const PREV_KEYS = new Set(["ArrowLeft", "ArrowUp"]);

/**
 * WAI-ARIA radiogroup: one tab stop (the checked option), arrow keys move and
 * select, disabled options are skipped.
 */
export function ChoiceGroup<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled = false,
  variant = "segmented",
  className,
}: ChoiceGroupProps<T>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const enabled = options.map((o) => !disabled && !o.disabled);
  const checkedIndex = options.findIndex((o) => o.value === value);
  const focusIndex = checkedIndex >= 0 && enabled[checkedIndex] ? checkedIndex : enabled.indexOf(true);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = NEXT_KEYS.has(event.key) ? 1 : PREV_KEYS.has(event.key) ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    const from = refs.current.findIndex((el) => el === document.activeElement);
    const start = from >= 0 ? from : focusIndex;
    for (let i = 1; i <= options.length; i++) {
      const idx = (start + step * i + options.length * i) % options.length;
      const option = options[idx];
      if (option && enabled[idx]) {
        refs.current[idx]?.focus();
        onChange(option.value);
        return;
      }
    }
  };

  return (
    <div
      role="radiogroup"
      aria-label={label}
      aria-disabled={disabled || undefined}
      onKeyDown={onKeyDown}
      className={cn(
        variant === "segmented"
          ? "sg:inline-flex sg:h-8 sg:items-center sg:gap-0.5 sg:rounded-md sg:bg-muted sg:p-0.5"
          : "sg:grid sg:auto-cols-fr sg:grid-flow-col sg:gap-2",
        className,
      )}
    >
      {options.map((option, index) => {
        const checked = option.value === value;
        return (
          <button
            key={option.value}
            ref={(el) => {
              refs.current[index] = el;
            }}
            type="button"
            // biome-ignore lint/a11y/useSemanticElements: styled segmented/card radio; arrow keys handled by the group
            role="radio"
            aria-checked={checked}
            data-state={checked ? "on" : "off"}
            disabled={!enabled[index]}
            tabIndex={index === focusIndex ? 0 : -1}
            onClick={() => onChange(option.value)}
            className={cn(
              "sg:outline-none sg:transition-[color,background-color,border-color,box-shadow] sg:duration-150 sg:focus-visible:ring-[3px] sg:focus-visible:ring-ring sg:disabled:cursor-not-allowed sg:disabled:opacity-50",
              variant === "segmented"
                ? [
                    "sg:inline-flex sg:h-7 sg:items-center sg:justify-center sg:gap-1.5 sg:rounded-[5px] sg:px-3 sg:text-sm sg:font-medium sg:whitespace-nowrap sg:text-muted-foreground",
                    "sg:enabled:hover:text-foreground sg:data-[state=on]:bg-background sg:data-[state=on]:text-foreground sg:data-[state=on]:shadow-xs",
                  ]
                : [
                    "sg:flex sg:items-start sg:gap-3 sg:rounded-lg sg:border sg:border-border sg:bg-background sg:p-3 sg:text-left",
                    "sg:enabled:hover:border-input-hover sg:enabled:hover:bg-subtle",
                    "sg:data-[state=on]:border-primary sg:data-[state=on]:bg-primary-subtle sg:data-[state=on]:shadow-[inset_0_0_0_1px_var(--sg-ui-primary)]",
                  ],
            )}
          >
            {variant === "cards" ? (
              <>
                {option.icon ? (
                  <span
                    className={cn(
                      "sg:flex sg:size-8 sg:shrink-0 sg:items-center sg:justify-center sg:rounded-md sg:bg-muted sg:text-muted-foreground",
                      checked && "sg:bg-background sg:text-primary",
                    )}
                  >
                    {option.icon}
                  </span>
                ) : null}
                <span className="sg:flex sg:min-w-0 sg:flex-col sg:gap-0.5">
                  <span className="sg:text-sm sg:font-medium sg:text-foreground">{option.label}</span>
                  {option.description ? <span className="sg:text-xs sg:text-muted-foreground">{option.description}</span> : null}
                </span>
              </>
            ) : (
              option.label
            )}
          </button>
        );
      })}
    </div>
  );
}

export function InlineAlert({ title, children, className }: { title?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div role="alert" className={cn("sg:flex sg:gap-2.5 sg:rounded-md sg:bg-danger-subtle sg:px-3 sg:py-2.5 sg:text-sm", className)}>
      <CircleAlertIcon aria-hidden className="sg:mt-px sg:size-4 sg:shrink-0 sg:text-danger" />
      <div className="sg:flex sg:min-w-0 sg:flex-col sg:gap-0.5">
        {title ? <p className="sg:m-0 sg:font-medium sg:text-danger">{title}</p> : null}
        <p className="sg:m-0 sg:break-words sg:text-foreground">{children}</p>
      </div>
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <LoaderCircleIcon aria-hidden className={cn("sg:size-4 sg:animate-spin sg:text-muted-foreground", className)} />;
}
