import type { ReactNode } from "react";
import type { Option } from "../internal/core-contracts";
import { SG_ROOT, cn } from "../lib/cn";

/**
 * Stable across renders: ag-grid-react treats a new `doesFilterPass` identity on a
 * re-render of an active filter as "the filter logic changed" and fires a spurious
 * `filterChanged`, which resets the infinite row model (a duplicate server fetch).
 */
export const PASS_ALL_FILTER_METHODS = { doesFilterPass: () => true };

/** A select-like option normalised for filter UIs (`id` is the stored value); keeps its tone. */
export interface FilterChoice {
  id: string;
  label: string;
  color?: string;
  avatarUrl?: string;
}

/** Accepts core `Option`s (and the older `{ value, label }` shape). */
export function toChoices(list: readonly unknown[]): FilterChoice[] {
  const out: FilterChoice[] = [];
  for (const raw of list) {
    if (typeof raw !== "object" || raw === null) continue;
    const o = raw as { id?: unknown; value?: unknown; label?: unknown; color?: unknown; avatarUrl?: unknown };
    const id = o.id ?? o.value;
    if (id === undefined || id === null) continue;
    out.push({
      id: String(id),
      label: o.label === undefined || o.label === null ? String(id) : String(o.label),
      color: typeof o.color === "string" ? o.color : undefined,
      avatarUrl: typeof o.avatarUrl === "string" ? o.avatarUrl : undefined,
    });
  }
  return out;
}

/** Static options from a select-like column config (empty when there are none). */
export function configChoices(config: unknown): FilterChoice[] {
  const options = (config as { options?: unknown } | null | undefined)?.options;
  return Array.isArray(options) ? toChoices(options) : [];
}

export const choiceAsOption = (c: FilterChoice): Option => ({ id: c.id, label: c.label, color: c.color });

/** Column filter popup chrome: body + (optional) footer on a subtle band, one hairline between. */
export function FilterShell({ className, children, footer }: { className?: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className={cn(SG_ROOT, "sg-filter sg:flex sg:w-[272px] sg:flex-col sg:bg-popover sg:text-foreground", className)}>
      {children}
      {footer ? (
        <div className="sg:flex sg:items-center sg:justify-between sg:gap-2 sg:border-t sg:border-border sg:bg-subtle sg:px-2 sg:py-1.5">{footer}</div>
      ) : null}
    </div>
  );
}
