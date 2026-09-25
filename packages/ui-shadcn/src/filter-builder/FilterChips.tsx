import { EyeOffIcon, XIcon } from "lucide-react";
import type { AccessMap } from "../internal/access";
import { type FieldTypeRegistry, type FilterNode, type GridSchema, isFilterGroup } from "../internal/core-contracts";
import { SG_ROOT, cn } from "../lib/cn";
import { describeConditionParts, describeNode } from "./describeFilter";
import { sameFilter } from "./filterApplyModel";
import { countConditions } from "./model";

export interface FilterChipsProps {
  schema: GridSchema;
  registry: FieldTypeRegistry;
  /** The APPLIED filter; chips always describe it. */
  value: FilterNode | null;
  onChange(node: FilterNode | null): void;
  /** When given, conditions on hidden columns read "Hidden column" instead of leaking the label. */
  access?: AccessMap;
  /** The working draft; when it differs from `value` an "Unapplied changes" dot shows. */
  draft?: FilterNode | null;
  /** Force the unapplied-changes dot (e.g. from `onDraftChange`). */
  dirty?: boolean;
  className?: string;
}

/** Accent dot marking unapplied filter edits. */
export function UnappliedDot({ className }: { className?: string }) {
  return (
    <span
      role="img"
      aria-label="Unapplied changes"
      title="Unapplied changes"
      className={cn("sg:inline-block sg:size-1.5 sg:shrink-0 sg:rounded-full sg:bg-primary", className)}
    />
  );
}

/** One removable pill per top-level child of the APPLIED filter (nested groups are summarised). */
export function FilterChips({ schema, registry, value, onChange, access, draft, dirty, className }: FilterChipsProps) {
  const root = value ? (isFilterGroup(value) ? value : { op: "and" as const, children: [value] }) : null;
  const children = root?.children ?? [];
  const unapplied = Boolean(dirty) || (draft !== undefined && !sameFilter(draft, value));
  if (children.length === 0 && !unapplied) return null;

  const removeAt = (index: number) => {
    if (!root) return;
    const rest = root.children.filter((_, i) => i !== index);
    onChange(rest.length === 0 ? null : { op: root.op, children: rest });
  };

  return (
    <div className={cn(SG_ROOT, "sg:flex sg:min-w-0 sg:flex-wrap sg:items-center sg:gap-1.5", className)}>
      {unapplied ? <UnappliedDot className="sg:mx-0.5" /> : null}
      <ul aria-label="Active filters" className="sg:m-0 sg:flex sg:min-w-0 sg:list-none sg:flex-wrap sg:items-center sg:gap-1.5 sg:p-0">
        {children.map((child, i) => {
          const label = describeNode(child, schema, registry, access);
          return (
            <li
              key={`${i}:${label}`}
              aria-label={label}
              className="sg:inline-flex sg:h-7 sg:max-w-80 sg:min-w-0 sg:items-center sg:gap-1 sg:rounded-md sg:border sg:border-border sg:bg-background sg:pr-0.5 sg:pl-2 sg:text-xs sg:shadow-xs"
            >
              <span className="sg:flex sg:min-w-0 sg:items-center sg:gap-1 sg:truncate">
                <ChipBody node={child} schema={schema} registry={registry} access={access} />
              </span>
              <button
                type="button"
                aria-label={`Remove filter: ${label}`}
                onClick={() => removeAt(i)}
                className="sg:inline-flex sg:size-5 sg:shrink-0 sg:items-center sg:justify-center sg:rounded-sm sg:text-muted-foreground sg:outline-none sg:transition-colors sg:hover:bg-muted sg:hover:text-foreground sg:focus-visible:ring-[3px] sg:focus-visible:ring-ring"
              >
                <XIcon aria-hidden className="sg:size-3" />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function ChipBody({
  node,
  schema,
  registry,
  access,
}: {
  node: FilterNode;
  schema: GridSchema;
  registry: FieldTypeRegistry;
  access?: AccessMap;
}) {
  if (isFilterGroup(node)) {
    const n = countConditions(node);
    return (
      <>
        <span className="sg:text-foreground sg:tabular-nums">{`${n} ${n === 1 ? "condition" : "conditions"}`}</span>{" "}
        <span className="sg:rounded-xs sg:bg-muted sg:px-1 sg:text-2xs sg:font-medium sg:text-muted-foreground">{node.op.toUpperCase()}</span>
      </>
    );
  }
  const p = describeConditionParts(node, schema, registry, access);
  if (p.hidden) {
    return (
      <span className="sg:flex sg:items-center sg:gap-1 sg:text-muted-foreground">
        <EyeOffIcon aria-hidden className="sg:size-3" />
        {p.column}
      </span>
    );
  }
  return (
    <>
      {/* the " " text nodes keep textContent readable; flex layout ignores them */}
      <span className="sg:truncate sg:text-muted-foreground">{p.column}</span>{" "}
      <span className="sg:shrink-0 sg:text-muted-foreground">{p.operator}</span>
      {p.value !== null && p.value !== "" ? (
        <>
          {" "}
          <span className="sg:truncate sg:font-medium sg:text-foreground">{p.value}</span>
        </>
      ) : null}
    </>
  );
}
