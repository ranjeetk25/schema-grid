import { Link2Icon, XIcon } from "lucide-react";
import { useCallback, useState } from "react";
import type { LinkRef } from "../internal/core-contracts";
import { type UiEditorProps, toPopupGridEditor } from "../internal/grid-contracts";
import { SG_ROOT, cn } from "../lib/cn";
import { Badge } from "../ui/badge";
import { AsyncCombobox } from "./AsyncCombobox";

/** Core link values are always `LinkRef[]`; a lone `LinkRef` is accepted on read. */
export type LinkValue = LinkRef[] | LinkRef;
export type LinkPickerEditorProps = UiEditorProps<LinkValue, unknown>;

const isLinkRef = (v: unknown): v is LinkRef =>
  !!v && typeof v === "object" && typeof (v as LinkRef).id === "string" && typeof (v as LinkRef).label === "string";

/** Core `LinkConfig.multiple` (defaults to true in core). */
const allowsMultiple = (config: unknown): boolean =>
  !(!!config && typeof config === "object" && (config as { multiple?: unknown }).multiple === false);

const toList = (value: LinkValue | null): LinkRef[] =>
  Array.isArray(value) ? value.filter(isLinkRef) : isLinkRef(value) ? [value] : [];

function LinkPill({ link, onRemove }: { link: LinkRef; onRemove?: () => void }) {
  return (
    <Badge variant="outline" className={cn("sg:max-w-full sg:text-foreground", onRemove && "sg:pr-0.5")}>
      <Link2Icon aria-hidden className="sg:size-3 sg:shrink-0 sg:text-faint-foreground" />
      <span className="sg:truncate">{link.label}</span>
      {onRemove ? (
        <button
          type="button"
          aria-label={`Remove ${link.label}`}
          className="sg:inline-flex sg:size-4 sg:shrink-0 sg:items-center sg:justify-center sg:rounded-xs sg:text-muted-foreground sg:outline-none sg:hover:bg-muted sg:hover:text-foreground sg:focus-visible:ring-2 sg:focus-visible:ring-ring"
          onClick={onRemove}
        >
          <XIcon className="sg:size-3" />
        </button>
      ) : null}
    </Badge>
  );
}

/**
 * Link-to-record picker over `dataSource.lookup(column.id, search)`.
 * Always emits core's `LinkRef[]`. With `config.multiple === false` a pick
 * emits and commits `[link]`; otherwise picks accumulate as removable pills
 * (wrapping at the top of the card) and Enter on an empty search commits the list.
 */
export function LinkPickerEditor({ value, onChange, onCommit, onCancel, column, config, dataSource, autoFocus, error, cellWidth }: LinkPickerEditorProps) {
  const multiple = allowsMultiple(config);
  const lookup = dataSource?.lookup;
  const [picked, setPicked] = useState<LinkRef[]>(() => toList(value));

  const load = useCallback(
    (search: string): Promise<LinkRef[]> => (lookup ? lookup(column.id, search) : Promise.resolve([])),
    [lookup, column.id],
  );

  if (!lookup) {
    const current = toList(value);
    return (
      <div className={cn(SG_ROOT, "sg:flex sg:flex-col sg:gap-1 sg:px-2.5 sg:py-2")}>
        {current.length > 0 ? <span className="sg:text-sm">{current.map((l) => l.label).join(", ")}</span> : null}
        <span className="sg:text-xs sg:text-muted-foreground">Lookup not configured</span>
      </div>
    );
  }

  const update = (next: LinkRef[]) => {
    setPicked(next);
    onChange(next);
  };

  const pills =
    multiple && picked.length > 0 ? (
      <div data-testid="link-picker-pills" className="sg:flex sg:flex-wrap sg:gap-1 sg:border-b sg:border-border sg:px-2 sg:py-2">
        {picked.map((link) => (
          <LinkPill key={link.id} link={link} onRemove={() => update(picked.filter((p) => p.id !== link.id))} />
        ))}
      </div>
    ) : null;

  const single = !multiple ? toList(value)[0] : undefined;
  const current = multiple ? picked : toList(value);

  return (
    <AsyncCombobox<LinkRef>
      load={load}
      getKey={(l) => l.id}
      getLabel={(l) => l.label}
      value={single?.id ?? null}
      valueLabel={single?.label}
      display={current.length > 0 ? current.map((l) => l.label).join(", ") : undefined}
      onSelect={(link) => {
        if (!multiple) {
          onChange([link]);
          onCommit([link]);
          return;
        }
        if (picked.some((p) => p.id === link.id)) return;
        update([...picked, link]);
      }}
      onSubmitEmpty={(search) => {
        if (search.trim() !== "") return;
        onCommit(multiple ? picked : toList(value));
      }}
      onCancel={onCancel}
      placeholder="Search records…"
      autoFocus={autoFocus}
      error={error}
      aria-label={column.label}
      header={multiple ? pills : undefined}
      cellWidth={cellWidth}
    />
  );
}

export const LinkPickerPopupEditor = toPopupGridEditor(LinkPickerEditor);
