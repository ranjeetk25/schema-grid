import { type KeyboardEvent, useId, useRef, useState } from "react";
import type { FieldTypeId, FieldTypeRegistry } from "../internal/core-contracts";
import { SG_ROOT, cn } from "../lib/cn";
import { fieldTypeMeta } from "./type-meta";

export interface TypeStepProps {
  registry: FieldTypeRegistry;
  value: FieldTypeId | null;
  onChange(type: FieldTypeId): void;
  /** Edit mode: the type cannot change. */
  locked?: boolean;
  /** Grid columns (default 3). */
  columns?: number;
}

/**
 * Grid of field-type cards (radio group). Arrow keys move focus across the
 * grid; Enter / Space / click selects.
 */
export function TypeStep({ registry, value, onChange, locked = false, columns = 3 }: TypeStepProps) {
  const types = registry.list();
  const baseId = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const selectedIndex = types.findIndex((t) => t.id === value);
  const [focusIndex, setFocusIndex] = useState(selectedIndex === -1 ? 0 : selectedIndex);

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const deltas: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: columns, ArrowUp: -columns };
    let next: number | null = null;
    if (e.key in deltas) next = Math.min(types.length - 1, Math.max(0, index + (deltas[e.key] ?? 0)));
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = types.length - 1;
    if (next === null) return;
    e.preventDefault();
    setFocusIndex(next);
    refs.current[next]?.focus();
  };

  return (
    <div
      role="radiogroup"
      aria-label="Field type"
      className={cn(SG_ROOT, "sg:grid sg:gap-2")}
      style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
    >
      {types.map((t, i) => {
        const selected = t.id === value;
        const meta = fieldTypeMeta(t.id, t);
        const Icon = meta.icon;
        const disabled = locked && !selected;
        return (
          <button
            key={t.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            // biome-ignore lint/a11y/useSemanticElements: rich card radios (icon + label + description)
            role="radio"
            aria-checked={selected}
            aria-label={t.label}
            aria-describedby={`${baseId}-${t.id}`}
            aria-disabled={disabled || undefined}
            tabIndex={i === focusIndex ? 0 : -1}
            onFocus={() => setFocusIndex(i)}
            onKeyDown={(e) => onKeyDown(e, i)}
            onClick={() => {
              if (!locked) onChange(t.id);
            }}
            className={cn(
              "sg:flex sg:items-start sg:gap-2.5 sg:rounded-lg sg:border sg:border-border sg:bg-background sg:p-3 sg:text-left sg:outline-none",
              "sg:transition-[border-color,background-color,box-shadow] sg:duration-150 sg:hover:border-input-hover sg:hover:bg-subtle",
              "sg:focus-visible:ring-[3px] sg:focus-visible:ring-ring",
              selected && "sg:border-primary sg:bg-primary-subtle sg:ring-1 sg:ring-primary sg:hover:border-primary sg:hover:bg-primary-subtle",
              disabled && "sg:cursor-not-allowed sg:opacity-50",
            )}
          >
            <Icon aria-hidden className={cn("sg:mt-px sg:size-4 sg:shrink-0", selected ? "sg:text-primary" : "sg:text-muted-foreground")} />
            <span className="sg:flex sg:min-w-0 sg:flex-col sg:gap-0.5">
              <span className="sg:text-sm sg:font-medium sg:text-foreground">{t.label}</span>
              <span id={`${baseId}-${t.id}`} className="sg:text-xs sg:text-muted-foreground">
                {meta.description}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
