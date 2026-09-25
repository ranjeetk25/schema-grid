import { type ReactNode, useId, useMemo } from "react";
import { SG_ROOT, cn } from "../lib/cn";
import type { ChangeConflict, ColumnDef, FieldTypeRegistry } from "../internal/core-contracts";
import { type ConflictResolution, type UiFieldTypeRegistry, resolveRendererWidget } from "../internal/grid-contracts";
import { formatRelativeTime } from "../internal/relative-time";
import { Avatar } from "../ui/avatar";
import { Button } from "../ui/button";
import { Popover, PopoverAnchor, PopoverContent } from "../ui/popover";

/** Anything with a bounding rect: a cell element or a virtual rect. */
export interface ConflictAnchor {
  getBoundingClientRect(): DOMRect;
}

export interface ConflictPopoverProps {
  conflict: ChangeConflict;
  column: ColumnDef;
  registry: FieldTypeRegistry;
  uiRegistry: UiFieldTypeRegistry;
  now?: Date | string | number;
  opened: boolean;
  /** Wire to ag-grid's `resolve` from `events.onConflict(conflict, resolve)` (see `useShadcnConflictPrompt`). */
  onResolve(resolution: ConflictResolution): void | Promise<void>;
  /** Escape / outside click: dismiss without resolving. */
  onClose?(): void;
  /** The value this user tried to write; shown as "Yours" when given. */
  yourValue?: unknown;
  /**
   * Anchor when there are no `children`: the cell element (e.g.
   * `api.getCellRendererInstances` / `document.querySelector`) or a virtual rect.
   */
  anchor?: ConflictAnchor | null;
  /** The cell anchor. */
  children?: ReactNode;
}

function ValueRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="sg:grid sg:grid-cols-[52px_minmax(0,1fr)] sg:items-center sg:gap-2 sg:py-1">
      <span className="sg:text-xs sg:text-muted-foreground">{label}</span>
      <div className="sg:flex sg:min-h-6 sg:min-w-0 sg:items-center sg:truncate sg:text-sm">{children}</div>
    </div>
  );
}

/**
 * Anchored to the conflicting cell, rendered in place (not portalled) so it
 * stays inside the grid's scroll container and moves with the cell. Does not
 * steal focus on open (a conflict can arrive while the user edits another cell).
 */
export function ConflictPopover({
  conflict,
  column,
  registry,
  uiRegistry,
  now,
  opened,
  onResolve,
  onClose,
  yourValue,
  anchor,
  children,
}: ConflictPopoverProps) {
  const headingId = `sg-conflict-heading-${useId()}`;
  const name = conflict.updatedBy?.name;
  const when = formatRelativeTime(conflict.updatedAt, now ?? new Date());
  const Renderer = resolveRendererWidget(uiRegistry.get(column.type).renderer);
  const fieldType = registry.get(column.type);
  const virtualRef = useMemo(() => ({ current: anchor ?? null }), [anchor]);

  const render = (value: unknown) =>
    Renderer ? (
      <Renderer value={value} column={column} config={column.config} fieldType={column.type} />
    ) : (
      <span className="sg:truncate">{fieldType ? fieldType.format(value, column.config) : String(value ?? "")}</span>
    );

  return (
    <Popover open={opened} onOpenChange={(open) => (open ? undefined : onClose?.())}>
      {children != null ? (
        <PopoverAnchor asChild>
          <span className="sg:inline-block">{children}</span>
        </PopoverAnchor>
      ) : (
        <PopoverAnchor virtualRef={virtualRef} />
      )}
      <PopoverContent
        portalled={false}
        side="bottom"
        align="start"
        aria-labelledby={headingId}
        onOpenAutoFocus={(e) => e.preventDefault()}
        className={cn(SG_ROOT, "sg:flex sg:w-72 sg:flex-col sg:gap-3 sg:p-3")}
      >
        <div className="sg:flex sg:flex-col sg:gap-1.5">
          <h2 id={headingId} className="sg:m-0 sg:text-sm sg:font-semibold sg:text-foreground">
            Edit conflict
          </h2>
          <div className="sg:flex sg:items-center sg:gap-2">
            <Avatar name={name ?? "?"} size="sm" />
            <p className="sg:m-0 sg:text-xs sg:text-muted-foreground">
              {`${name ?? "Someone"} changed this ${when}`}
            </p>
          </div>
        </div>
        <div className="sg:rounded-md sg:bg-subtle sg:px-2.5 sg:py-1">
          <ValueRow label="Theirs">{render(conflict.serverValue)}</ValueRow>
          {yourValue !== undefined ? <ValueRow label="Yours">{render(yourValue)}</ValueRow> : null}
        </div>
        <div className="sg:flex sg:items-center sg:justify-end sg:gap-2">
          <Button size="sm" variant="secondary" onClick={() => void onResolve("keepTheirs")}>
            Keep theirs
          </Button>
          <Button size="sm" variant="primary" onClick={() => void onResolve("overwrite")}>
            Overwrite
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
