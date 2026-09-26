import { ArrowDown, ArrowUp, Check, GripVertical, LockIcon, Plus, X } from "lucide-react";
import {
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { RoleRule } from "../../internal/core-contracts";
import { OPTION_TONES, optionToneStyle } from "../../internal/options";
import { cn } from "../../lib/cn";
import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "../../ui/popover";
import { ToggleGroup, ToggleGroupItem } from "../../ui/toggle-group";
import { Tooltip } from "../../ui/tooltip";
import { titleCaseRole } from "../permissions-model";

export interface OptionListItem {
  label: string;
  value: string;
  color?: string;
  /** Who may SET this option (core `Option.settableBy`, v0.3). Absent = everyone. */
  settableBy?: RoleRule;
}

export interface OptionListFieldProps {
  label: ReactNode;
  description?: ReactNode;
  value: unknown;
  /** Emits options keyed by `valueKey` (e.g. core `{id, label, color?, settableBy?}`). */
  onChange: (next: Record<string, unknown>[]) => void;
  /** Whether the schema's option object has a `color` field. */
  hasColor: boolean;
  /** Key of the stored value: `"id"` for core options (default `"value"`). */
  valueKey?: "id" | "value";
  /**
   * Roles offered by the per-option "Who can set" control (core options only,
   * i.e. `valueKey: "id"`). Absent → the control is not shown.
   */
  roles?: string[];
  error?: string;
  /** Per-row errors, e.g. `rowErrors(0, "label")`. */
  rowError?: (index: number, field: "label" | "value" | "color") => string | undefined;
}

interface Row {
  id: number;
  label: string;
  value: string;
  color?: string;
  settableBy?: RoleRule;
  /** Once true, editing the label no longer re-derives the value. */
  valueEdited: boolean;
}

const isRoleRule = (v: unknown): v is RoleRule =>
  v === "all" || (!!v && typeof v === "object" && Array.isArray((v as { roles?: unknown }).roles));

/** "In Progress!" → "in_progress": lowercase, non-alphanumerics → "_", trimmed underscores. */
export function slugifyOptionValue(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

const readOptions = (value: unknown, valueKey: "id" | "value"): OptionListItem[] =>
  Array.isArray(value)
    ? value
        .filter((o): o is Record<string, unknown> => !!o && typeof o === "object")
        .map((o) => ({
          label: typeof o.label === "string" ? o.label : "",
          value: typeof o[valueKey] === "string" ? (o[valueKey] as string) : "",
          ...(typeof o.color === "string" && o.color ? { color: o.color } : {}),
          ...(isRoleRule(o.settableBy) ? { settableBy: o.settableBy } : {}),
        }))
    : [];

const list = (roles: string[]) => {
  const labels = roles.map(titleCaseRole);
  return labels.length <= 1 ? labels.join("") : `${labels.slice(0, -1).join(", ")} and ${labels.at(-1)}`;
};

/** "Everyone" / "Only Admin and Finance team" / "Nobody yet". */
export function settableBySummary(rule: RoleRule | undefined): string {
  if (rule === undefined || rule === "all") return "Everyone";
  return rule.roles.length === 0 ? "Nobody yet" : `Only ${list(rule.roles)}`;
}

/**
 * Per-option "Who can set" (v0.3): a subtle pill that opens a small popover
 * with the same "Everyone | Only roles…" control as the column's access
 * section. Absent `settableBy` = everyone (never written as `"all"` unless it
 * already was).
 */
function WhoCanSet({ label, rule, roles, onChange }: { label: string; rule: RoleRule | undefined; roles: string[]; onChange(rule: RoleRule | undefined): void }) {
  const [open, setOpen] = useState(false);
  const labelId = useId();
  const restricted = rule !== undefined && rule !== "all";
  const selected = restricted ? rule.roles : [];
  const offered = [...roles, ...selected.filter((r) => !roles.includes(r))];
  const summary = settableBySummary(rule);
  const who = label || "this option";
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="xs"
          aria-label={`Who can set ${who}: ${summary}`}
          aria-expanded={open}
          data-testid="option-settable-by"
          className={cn("sg:max-w-40 sg:font-normal", restricted ? "sg:text-foreground" : "sg:text-muted-foreground")}
        >
          {restricted ? <LockIcon aria-hidden className="sg:size-3" /> : null}
          <span className="sg:truncate">{summary}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" portalled={false} className="sg:w-80" aria-label={`Who can set ${who}`}>
        <div className="sg:flex sg:flex-col sg:gap-2">
          <div className="sg:flex sg:items-center sg:justify-between sg:gap-3">
            <span id={labelId} className="sg:text-sm sg:whitespace-nowrap sg:text-foreground">
              Who can set
            </span>
            <ToggleGroup
              type="single"
              aria-labelledby={labelId}
              value={restricted ? "roles" : "all"}
              onValueChange={(v) => {
                if (v === "all") onChange(rule === "all" ? "all" : undefined);
                else if (v === "roles") onChange({ roles: selected });
              }}
            >
              <ToggleGroupItem value="all">Everyone</ToggleGroupItem>
              <ToggleGroupItem value="roles">Only roles…</ToggleGroupItem>
            </ToggleGroup>
          </div>
          {restricted ? (
            <div className="sg:flex sg:flex-col sg:gap-1.5">
              {offered.length ? (
                <fieldset aria-label={`Roles that can set ${who}`} className="sg:m-0 sg:flex sg:min-w-0 sg:flex-wrap sg:gap-1.5 sg:border-0 sg:p-0">
                  {offered.map((role) => {
                    const on = selected.includes(role);
                    return (
                      <button
                        key={role}
                        type="button"
                        aria-pressed={on}
                        onClick={() => onChange({ roles: on ? selected.filter((r) => r !== role) : [...selected, role] })}
                        className={cn(
                          "sg:inline-flex sg:h-6 sg:items-center sg:gap-1 sg:rounded-full sg:border sg:px-2.5 sg:text-xs sg:font-medium sg:outline-none",
                          "sg:transition-colors sg:duration-150 sg:focus-visible:ring-[3px] sg:focus-visible:ring-ring",
                          on
                            ? "sg:border-primary sg:bg-primary-subtle sg:text-primary"
                            : "sg:border-border sg:text-muted-foreground sg:hover:border-input-hover sg:hover:text-foreground",
                        )}
                      >
                        {on ? <Check aria-hidden className="sg:size-3" /> : null}
                        {titleCaseRole(role)}
                      </button>
                    );
                  })}
                </fieldset>
              ) : (
                <p className="sg:text-xs sg:text-muted-foreground">This grid has no roles to choose from.</p>
              )}
              {selected.length === 0 ? (
                <p role="alert" className="sg:text-xs sg:text-danger">
                  Pick at least one role
                </p>
              ) : null}
            </div>
          ) : (
            <p className="sg:text-xs sg:text-muted-foreground">Anyone who can edit the column can pick this option.</p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function projectRows(rows: Row[], hasColor: boolean | undefined, valueKey: "id" | "value"): Record<string, unknown>[] {
  return rows.map((r) =>
    valueKey === "id"
      ? {
          id: r.value,
          label: r.label,
          ...(hasColor && r.color ? { color: r.color } : {}),
          ...(r.settableBy !== undefined ? { settableBy: r.settableBy } : {}),
        }
      : { label: r.label, value: r.value, ...(hasColor && r.color ? { color: r.color } : {}) },
  );
}

/** Moves `list[from]` to index `to`. */
function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item as T);
  return next;
}

/** A row of tone dots (radio group): visible upfront, the current tone ringed, arrow keys move. */
function ToneSwatches({ color, onPick, error }: { color?: string; onPick: (color: string) => void; error?: string }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const checkedIndex = OPTION_TONES.findIndex((t) => t === color);
  const tabIndexFor = (i: number) => (checkedIndex === -1 ? (i === 0 ? 0 : -1) : i === checkedIndex ? 0 : -1);

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const delta = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!delta) return;
    e.preventDefault();
    const next = (index + delta + OPTION_TONES.length) % OPTION_TONES.length;
    const tone = OPTION_TONES[next];
    if (!tone) return;
    onPick(tone);
    refs.current[next]?.focus();
  };

  return (
    <div
      role="radiogroup"
      aria-label="Option colour"
      aria-invalid={error ? true : undefined}
      title={error}
      className="sg:flex sg:flex-wrap sg:items-center sg:gap-1"
    >
      {OPTION_TONES.map((tone, i) => {
        const checked = tone === color;
        return (
          <button
            key={tone}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={tone}
            tabIndex={tabIndexFor(i)}
            style={optionToneStyle({ color: tone })}
            onClick={() => onPick(tone)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={cn(
              "sg:size-3.5 sg:shrink-0 sg:rounded-full sg:bg-[var(--sg-tone-dot)] sg:outline-none",
              "sg:ring-offset-2 sg:ring-offset-background sg:transition-[box-shadow,transform] sg:duration-150",
              "sg:hover:scale-110 sg:focus-visible:ring-2 sg:focus-visible:ring-ring",
              checked && "sg:ring-2 sg:ring-[var(--sg-tone-dot)]",
            )}
          />
        );
      })}
    </div>
  );
}

interface DragState {
  from: number;
  to: number;
  pointerId: number;
}

/**
 * Editable `{label, value, color?}[]` list: add, remove, reorder (drag handle,
 * Alt+↑/↓ or the move buttons), auto-derived values, colour swatches upfront.
 */
export function OptionListField({
  label,
  description,
  value,
  onChange,
  hasColor,
  valueKey = "value",
  error,
  rowError,
  roles,
}: OptionListFieldProps) {
  const showSettableBy = valueKey === "id" && roles !== undefined;
  const headingId = useId();
  const nextId = useRef(0);
  const toRows = (options: OptionListItem[]): Row[] =>
    options.map((o) => ({ id: nextId.current++, ...o, valueEdited: o.value !== slugifyOptionValue(o.label) }));

  const [rows, setRows] = useState<Row[]>(() => toRows(readOptions(value, valueKey)));
  const lastEmitted = useRef<unknown>(value);
  const [drag, setDrag] = useState<DragState | null>(null);
  const rowEls = useRef(new Map<number, HTMLElement>());
  const handleEls = useRef(new Map<number, HTMLElement>());
  const labelEls = useRef(new Map<number, HTMLInputElement>());
  const pendingFocus = useRef<{ id: number; target: "handle" | "label" } | null>(null);
  const [announcement, setAnnouncement] = useState("");

  // Resync when the value is replaced from outside (not by our own emit).
  // biome-ignore lint/correctness/useExhaustiveDependencies: toRows only touches a ref
  useEffect(() => {
    if (value === lastEmitted.current) return;
    lastEmitted.current = value;
    // Content-equal echoes (a parent that clones/normalises) must not rebuild rows: that remounts inputs.
    if (JSON.stringify(readOptions(value, valueKey)) === JSON.stringify(readOptions(projectRows(rows, hasColor, valueKey), valueKey))) return;
    setRows(toRows(readOptions(value, valueKey)));
  }, [value]);

  useLayoutEffect(() => {
    const pending = pendingFocus.current;
    if (!pending) return;
    pendingFocus.current = null;
    (pending.target === "handle" ? handleEls.current.get(pending.id) : labelEls.current.get(pending.id))?.focus();
  });

  const commit = (next: Row[]) => {
    setRows(next);
    const options = projectRows(next, hasColor, valueKey);
    lastEmitted.current = options;
    onChange(options);
  };

  const update = (index: number, patch: Partial<Row>) => commit(rows.map((r, i) => (i === index ? { ...r, ...patch } : r)));

  const move = (index: number, to: number, focus: "handle" | "label" | null = null) => {
    const row = rows[index];
    if (!row || to < 0 || to >= rows.length || to === index) return;
    if (focus) pendingFocus.current = { id: row.id, target: focus };
    commit(moveItem(rows, index, to));
    setAnnouncement(`${row.label || "Option"} moved to position ${to + 1} of ${rows.length}`);
  };

  // --- pointer drag on the handle -------------------------------------------------------
  // Row midpoints are snapshotted at drag start (rows re-flow while the preview moves).
  const slotMids = useRef<number[]>([]);
  const targetIndexAt = (clientY: number, from: number): number =>
    slotMids.current.reduce((n, mid, i) => (i !== from && clientY > mid ? n + 1 : n), 0);

  const onHandlePointerDown = (e: ReactPointerEvent<HTMLElement>, index: number) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    slotMids.current = rows.map((r) => {
      const rect = rowEls.current.get(r.id)?.getBoundingClientRect();
      return rect ? rect.top + rect.height / 2 : 0;
    });
    setDrag({ from: index, to: index, pointerId: e.pointerId });
  };
  const onHandlePointerMove = (e: ReactPointerEvent<HTMLElement>) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const to = targetIndexAt(e.clientY, drag.from);
    if (to !== drag.to) setDrag({ ...drag, to });
  };
  const onHandlePointerUp = (e: ReactPointerEvent<HTMLElement>) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    const { from, to } = drag;
    setDrag(null);
    move(from, to);
  };

  const onRowKeyDown = (e: KeyboardEvent<HTMLElement>, index: number, fromHandle: boolean) => {
    const up = e.key === "ArrowUp";
    const down = e.key === "ArrowDown";
    if (!(up || down) || (!fromHandle && !e.altKey)) return;
    e.preventDefault();
    move(index, index + (up ? -1 : 1), fromHandle ? "handle" : "label");
  };

  // Rows in on-screen order: while dragging, the dragged row previews at its drop slot.
  const display = drag ? moveItem(rows, drag.from, drag.to) : rows;
  const draggingId = drag ? rows[drag.from]?.id : undefined;

  return (
    <div className="sg:flex sg:flex-col sg:gap-2">
      <div className="sg:flex sg:items-baseline sg:justify-between sg:gap-2">
        <span id={headingId} className="sg:text-sm sg:font-medium sg:text-foreground">
          {label}
        </span>
        {rows.length > 0 ? (
          <span className="sg:text-xs sg:text-faint-foreground sg:tabular-nums">
            {rows.length} {rows.length === 1 ? "option" : "options"}
          </span>
        ) : null}
      </div>
      {description ? <p className="sg:-mt-1 sg:text-xs sg:text-muted-foreground">{description}</p> : null}

      <ul aria-labelledby={headingId} className="sg:flex sg:flex-col">
        {display.map((row) => {
          const index = rows.findIndex((r) => r.id === row.id);
          const dragging = row.id === draggingId;
          const labelError = rowError?.(index, "label");
          const valueError = rowError?.(index, "value");
          return (
            <li
              key={row.id}
              data-option-row=""
              ref={(el) => {
                if (el) rowEls.current.set(row.id, el);
                else rowEls.current.delete(row.id);
              }}
              className={cn(
                "sg:group sg:flex sg:flex-col sg:gap-1.5 sg:rounded-md sg:py-1.5 sg:pr-1 sg:transition-colors sg:duration-150",
                dragging && "sg:relative sg:z-10 sg:bg-muted sg:shadow-xs",
              )}
            >
              <div className="sg:flex sg:items-center sg:gap-1.5">
                <Tooltip content="Drag to reorder" shortcut="Alt ↑↓">
                  <button
                    type="button"
                    aria-label="Reorder option"
                    aria-describedby={`${headingId}-drag-help`}
                    ref={(el) => {
                      if (el) handleEls.current.set(row.id, el);
                      else handleEls.current.delete(row.id);
                    }}
                    onPointerDown={(e) => onHandlePointerDown(e, index)}
                    onPointerMove={onHandlePointerMove}
                    onPointerUp={onHandlePointerUp}
                    onPointerCancel={() => setDrag(null)}
                    onKeyDown={(e) => onRowKeyDown(e, index, true)}
                    className={cn(
                      "sg:flex sg:h-8 sg:w-4 sg:shrink-0 sg:touch-none sg:items-center sg:justify-center sg:rounded-xs sg:text-faint-foreground sg:outline-none",
                      "sg:cursor-grab sg:hover:text-foreground sg:focus-visible:ring-[3px] sg:focus-visible:ring-ring sg:active:cursor-grabbing",
                    )}
                  >
                    <GripVertical className="sg:size-3.5" />
                  </button>
                </Tooltip>
                {hasColor ? (
                  <span
                    aria-hidden
                    style={optionToneStyle({ color: row.color })}
                    className="sg:size-2 sg:shrink-0 sg:rounded-full sg:bg-[var(--sg-tone-dot)]"
                  />
                ) : null}
                <Input
                  aria-label="Option label"
                  placeholder="Label"
                  value={row.label}
                  aria-invalid={labelError ? true : undefined}
                  title={labelError}
                  ref={(el) => {
                    if (el) labelEls.current.set(row.id, el);
                    else labelEls.current.delete(row.id);
                  }}
                  className="sg:flex-1"
                  onKeyDown={(e) => onRowKeyDown(e, index, false)}
                  onChange={(e) => {
                    const text = e.currentTarget.value;
                    update(index, row.valueEdited ? { label: text } : { label: text, value: slugifyOptionValue(text) });
                  }}
                />
                <Input
                  aria-label={valueKey === "id" ? "Option id" : "Option value"}
                  placeholder={valueKey}
                  value={row.value}
                  aria-invalid={valueError ? true : undefined}
                  title={valueError}
                  spellCheck={false}
                  className="sg:w-28 sg:font-mono sg:text-xs sg:text-muted-foreground sg:focus-visible:text-foreground"
                  onKeyDown={(e) => onRowKeyDown(e, index, false)}
                  onChange={(e) => update(index, { value: e.currentTarget.value, valueEdited: true })}
                />
                {showSettableBy ? (
                  <WhoCanSet label={row.label} rule={row.settableBy} roles={roles ?? []} onChange={(settableBy) => update(index, { settableBy })} />
                ) : null}
                <div className="sg:flex sg:shrink-0 sg:items-center">
                  <Tooltip content="Move up" shortcut="Alt ↑">
                    <Button variant="subtle" size="icon-xs" aria-label="Move option up" disabled={index === 0} onClick={() => move(index, index - 1)}>
                      <ArrowUp />
                    </Button>
                  </Tooltip>
                  <Tooltip content="Move down" shortcut="Alt ↓">
                    <Button
                      variant="subtle"
                      size="icon-xs"
                      aria-label="Move option down"
                      disabled={index === rows.length - 1}
                      onClick={() => move(index, index + 1)}
                    >
                      <ArrowDown />
                    </Button>
                  </Tooltip>
                  <Tooltip content="Remove option">
                    <Button
                      variant="subtle"
                      size="icon-xs"
                      aria-label="Remove option"
                      className="sg:hover:text-danger"
                      onClick={() => commit(rows.filter((_, i) => i !== index))}
                    >
                      <X />
                    </Button>
                  </Tooltip>
                </div>
              </div>
              {hasColor ? (
                <div className="sg:pl-[34px]">
                  <ToneSwatches color={row.color} error={rowError?.(index, "color")} onPick={(color) => update(index, { color })} />
                </div>
              ) : null}
              {labelError || valueError ? (
                <p role="alert" className="sg:pl-[34px] sg:text-xs sg:text-danger">
                  {labelError ?? valueError}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
      <span id={`${headingId}-drag-help`} hidden>
        Press up or down arrow to move this option.
      </span>
      <span aria-live="polite" className="sg:sr-only">
        {announcement}
      </span>

      <Button
        variant="ghost"
        size="sm"
        className="sg:self-start sg:text-muted-foreground sg:hover:text-foreground"
        onClick={() => {
          const id = nextId.current++;
          pendingFocus.current = { id, target: "label" };
          commit([...rows, { id, label: "", value: "", valueEdited: false }]);
        }}
      >
        <Plus />
        Add option
      </Button>
      {error ? (
        <p role="alert" className="sg:text-xs sg:text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
