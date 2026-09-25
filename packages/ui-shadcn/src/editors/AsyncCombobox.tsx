import { CheckIcon, Loader2Icon } from "lucide-react";
import { type KeyboardEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { cn } from "../lib/cn";
import { Command, CommandInput, CommandItem, CommandList } from "../ui/command";
import { EditorCard, FormPicker } from "./EditorCard";
import { useCmdkEnter, useCmdkHighlight, useDebouncedValue, useElement } from "./useEditorKeys";

export interface AsyncComboboxProps<TItem> {
  /** Loads the items for a search string. Called once with "" on open/mount. */
  load(search: string): Promise<TItem[]>;
  getKey(item: TItem): string;
  getLabel(item: TItem): string;
  renderItem?(item: TItem): ReactNode;
  /** Key of the currently selected item (marked active in the list). */
  value?: string | null;
  /** Label for `value` when it is not among the loaded items. */
  valueLabel?: string;
  onSelect(item: TItem): void;
  /** @default 250 */
  debounceMs?: number;
  placeholder?: string;
  /** `autoFocus !== false`: focus the input and open (and load) on mount. */
  autoFocus?: boolean;
  /** Escape pressed in the input. */
  onCancel?(): void;
  /** Enter pressed while no option is highlighted. */
  onSubmitEmpty?(search: string): void;
  disabled?: boolean;
  readOnly?: boolean;
  error?: ReactNode;
  "aria-label"?: string;
  /** Rendered above the input (e.g. picked values as pills). Pass `null` (not `undefined`) to keep the layout stable while empty. */
  header?: ReactNode;
  /** Grid mode: the edited cell's width (the card is never narrower). */
  cellWidth?: number;
  /** Form mode: what the closed trigger shows (defaults to the selected label). */
  display?: ReactNode;
}

type LoadState = "idle" | "loading" | "done" | "error";

const errorText = (err: unknown): string =>
  err instanceof Error && err.message ? err.message : typeof err === "string" && err ? err : "Something went wrong";

const itemValue = (key: string) => `k:${key}`;

/**
 * Debounced async search list (cmdk). Grid mode (`autoFocus !== false`):
 * an opaque card, focused and loading on mount, list inline. Form / filter
 * mode: a 32px trigger; the popover loads on first open. Responses from
 * superseded requests are dropped. While searching, the first result is
 * highlighted so Enter picks it; with nothing highlighted Enter calls
 * `onSubmitEmpty`.
 */
export function AsyncCombobox<TItem>({
  load,
  getKey,
  getLabel,
  renderItem,
  value,
  valueLabel,
  onSelect,
  debounceMs = 250,
  placeholder,
  autoFocus,
  onCancel,
  onSubmitEmpty,
  disabled,
  readOnly,
  error,
  "aria-label": ariaLabel,
  header,
  cellWidth,
  display,
}: AsyncComboboxProps<TItem>) {
  const gridMode = autoFocus !== false;
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const debounced = useDebouncedValue(search, debounceMs);
  const [activated, setActivated] = useState(gridMode && !readOnly);
  const [items, setItems] = useState<TItem[]>([]);
  const [state, setState] = useState<LoadState>("idle");
  const [loadError, setLoadError] = useState<string | null>(null);
  const requestId = useRef(0);
  const loadRef = useRef(load);
  loadRef.current = load;
  const searchRef = useRef(search);
  searchRef.current = search;
  const highlight = useCmdkHighlight(() => searchRef.current.trim() !== "");
  const [root, setRoot] = useElement<HTMLDivElement>();
  useCmdkEnter(root);

  useEffect(() => {
    if (!activated) return;
    const id = ++requestId.current;
    setState("loading");
    setLoadError(null);
    loadRef.current(debounced).then(
      (result) => {
        if (id !== requestId.current) return;
        setItems(result);
        setState("done");
      },
      (err: unknown) => {
        if (id !== requestId.current) return;
        setItems([]);
        setLoadError(errorText(err));
        setState("error");
      },
    );
  }, [debounced, activated]);

  const selectedLabel = (() => {
    if (value == null) return undefined;
    const found = items.find((i) => getKey(i) === value);
    return found ? getLabel(found) : undefined;
  })();

  const handleSelect = (item: TItem) => {
    setSearch("");
    highlight.clear();
    setOpen(false);
    onSelect(item);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape" && gridMode) {
      event.preventDefault();
      onCancel?.();
      return;
    }
    if (event.key === "Enter" && !event.defaultPrevented) {
      event.preventDefault();
      onSubmitEmpty?.(search);
    }
  };

  const status = (() => {
    if (state === "error") return <span className="sg:text-danger">{`Could not load: ${loadError}`}</span>;
    if (items.length > 0) return null;
    if (state === "loading" || state === "idle") return "Loading…";
    return "No results";
  })();

  const list = (
    <Command ref={setRoot} shouldFilter={false} label={ariaLabel ?? "Results"} loop {...highlight.rootProps}>
      {header}
      <div className="sg:relative">
        <CommandInput
          autoFocus={gridMode && !readOnly}
          value={search}
          onValueChange={setSearch}
          placeholder={selectedLabel ?? valueLabel ?? placeholder}
          aria-label={ariaLabel}
          disabled={disabled}
          readOnly={readOnly}
          aria-invalid={error ? true : undefined}
          wrapperClassName="sg:pr-8"
          onKeyDown={handleKeyDown}
        />
        {state === "loading" && items.length > 0 ? (
          <Loader2Icon
            aria-hidden
            className="sg:absolute sg:top-1/2 sg:right-2.5 sg:size-3.5 sg:-translate-y-1/2 sg:animate-spin sg:text-faint-foreground"
          />
        ) : null}
      </div>
      {gridMode && error ? <p className="sg:border-b sg:border-border sg:px-2.5 sg:py-1.5 sg:text-xs sg:text-danger">{error}</p> : null}
      <CommandList {...highlight.listProps}>
        {items.map((item) => {
          const key = getKey(item);
          const active = key === value;
          return (
            <CommandItem key={key} value={itemValue(key)} disabled={readOnly || disabled} data-active={active || undefined} onSelect={() => handleSelect(item)}>
              <span className={cn("sg:flex sg:min-w-0 sg:flex-1 sg:items-center sg:gap-2", active && "sg:font-medium")}>
                {renderItem ? renderItem(item) : <span className="sg:truncate">{getLabel(item)}</span>}
              </span>
              {active ? <CheckIcon aria-hidden className="sg:size-3.5 sg:shrink-0 sg:text-primary" /> : null}
            </CommandItem>
          );
        })}
        {status != null ? (
          <div role="presentation" className="sg:px-2 sg:py-5 sg:text-center sg:text-sm sg:text-muted-foreground">
            {status}
          </div>
        ) : null}
      </CommandList>
    </Command>
  );

  if (gridMode) return <EditorCard cellWidth={cellWidth}>{list}</EditorCard>;

  return (
    <FormPicker
      open={open}
      onOpenChange={(next) => {
        if (readOnly) return;
        setOpen(next);
        if (next) setActivated(true);
        else setSearch("");
      }}
      label={ariaLabel}
      disabled={disabled}
      display={display ?? selectedLabel ?? valueLabel}
      placeholder={placeholder}
      error={typeof error === "string" ? error : undefined}
    >
      {list}
    </FormPicker>
  );
}
