import { Loader2Icon, PlusIcon } from "lucide-react";
import { type KeyboardEvent, useMemo, useRef, useState } from "react";
import type { Option } from "../internal/core-contracts";
import { type UiEditorProps, toPopupGridEditor } from "../internal/grid-contracts";
import { getSelectOptions } from "../internal/options";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "../ui/command";
import { EditorCard, FormPicker, OptionRowContent, ToneDot } from "./EditorCard";
import { isGridMode, useCmdkEnter, useCmdkHighlight, useElement, useMountedRef } from "./useEditorKeys";
import { filterOptions, optionItemValue } from "./useSelectOptions";

/**
 * Sentinel option value for the trailing "Create “<x>”" entry. Contains a NUL
 * character so it can never collide with a real option value such as "$create".
 * (Kept for API parity; list items are namespaced internally.)
 */
export const CREATE_OPTION_VALUE = "\u0000$create";
const CREATE_ITEM_VALUE = "c:create";

export type CreatableSelectEditorProps = UiEditorProps<string, unknown>;

const errorMessage = (err: unknown): string =>
  err instanceof Error && err.message ? err.message : typeof err === "string" && err ? err : "Could not create option";

/**
 * Searchable single select that can create new options through
 * `dataSource.createOption`. The typed label gets a trailing
 * `Create “label”` item (unless it matches an option, case-insensitively);
 * picking it creates the option, reports it via `onOptionCreate`, then
 * emits and commits its id. While creating, the input is disabled and busy;
 * a failure shows inline and keeps the editor open.
 */
export function CreatableSelectEditor(props: CreatableSelectEditorProps) {
  const { value, onChange, onCommit, onCancel, column, config, dataSource, autoFocus, error, cellWidth } = props;
  // Latest props for async continuations (avoids stale closures after await).
  const latest = useRef(props);
  latest.current = props;
  const mounted = useMountedRef();
  // Synchronous guard: state updates are too late to block a second submit.
  const creatingRef = useRef(false);
  const gridMode = isGridMode(autoFocus);
  const [created, setCreated] = useState<Option[]>([]);
  const options = useMemo(() => {
    const base = getSelectOptions(config);
    const extra = created.filter((c) => !base.some((b) => b.id === c.id));
    return [...base, ...extra];
  }, [config, created]);
  const selected = options.find((o) => o.id === value);
  const valueLabel = selected?.label ?? (value == null || value === "" ? undefined : String(value));

  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const query = search.trim();
  const isSearching = query !== "" && query !== valueLabel;
  const searchingRef = useRef(isSearching);
  searchingRef.current = isSearching;
  const highlight = useCmdkHighlight(() => searchingRef.current);
  const [root, setRoot] = useElement<HTMLDivElement>();
  useCmdkEnter(root);

  const filtered = isSearching ? filterOptions(options, query) : options;
  const exactMatch = options.some((o) => o.label.toLowerCase() === query.toLowerCase());
  const canCreate = typeof dataSource?.createOption === "function";
  const showCreate = canCreate && query !== "" && !exactMatch;

  const pick = (option: Option) => {
    setCreateError(null);
    setSearch("");
    setOpen(false);
    latest.current.onChange(option.id);
    latest.current.onCommit(option.id);
  };

  const create = async (label: string) => {
    const createOption = dataSource?.createOption;
    if (!createOption || creatingRef.current) return;
    creatingRef.current = true;
    setCreating(true);
    setCreateError(null);
    let option: Option;
    try {
      option = await createOption(column.id, label);
    } catch (err) {
      creatingRef.current = false;
      if (!mounted.current) return;
      setCreating(false);
      setCreateError(errorMessage(err));
      // Re-focus once the disabled input is re-enabled.
      setTimeout(() => {
        if (mounted.current) inputRef.current?.focus();
      }, 0);
      return;
    }
    creatingRef.current = false;
    // The option exists server-side now, so always report it.
    latest.current.onOptionCreate?.(option);
    if (!mounted.current) return;
    setCreated((prev) => [...prev, { id: option.id, label: option.label, color: option.color }]);
    setCreating(false);
    pick(option);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape" && gridMode) {
      event.preventDefault();
      onCancel();
      return;
    }
    if (event.key === "Enter" && !event.defaultPrevented) {
      // No highlighted option (those are picked natively): commit the value unchanged.
      event.preventDefault();
      if (!showCreate && !creatingRef.current) onCommit(value);
    }
  };

  const list = (
    <Command ref={setRoot} shouldFilter={false} label={column.label || "Options"} loop {...highlight.rootProps}>
      <div className="sg:relative">
        <CommandInput
          ref={inputRef}
          autoFocus={gridMode}
          value={search}
          onValueChange={(next) => {
            setSearch(next);
            setCreateError(null);
          }}
          placeholder={valueLabel ?? "Search or create…"}
          disabled={creating}
          aria-busy={creating || undefined}
          aria-invalid={createError || error ? true : undefined}
          wrapperClassName={creating ? "sg:pr-8" : undefined}
          onKeyDown={handleKeyDown}
        />
        {creating ? (
          <Loader2Icon
            role="status"
            aria-label="Creating option"
            data-testid="creatable-select-loader"
            className="sg:absolute sg:top-1/2 sg:right-2.5 sg:size-3.5 sg:-translate-y-1/2 sg:animate-spin sg:text-muted-foreground"
          />
        ) : null}
      </div>
      {(createError ?? error) ? (
        <p role="alert" className="sg:border-b sg:border-border sg:bg-danger-subtle sg:px-2.5 sg:py-1.5 sg:text-xs sg:text-danger">
          {createError ?? error}
        </p>
      ) : null}
      <CommandList {...highlight.listProps}>
        {!showCreate ? <CommandEmpty>Nothing found</CommandEmpty> : null}
        {filtered.map((option) => (
          <CommandItem key={option.id} value={optionItemValue(option.id)} disabled={creating} onSelect={() => !creatingRef.current && pick(option)}>
            <OptionRowContent option={option} selected={option.id === value} />
          </CommandItem>
        ))}
        {showCreate ? (
          <CommandItem value={CREATE_ITEM_VALUE} disabled={creating} onSelect={() => void create(query)} className="sg:text-muted-foreground">
            <PlusIcon aria-hidden className="sg:size-3.5 sg:shrink-0" />
            <span className="sg:min-w-0 sg:flex-1 sg:truncate">
              Create <span className="sg:font-medium sg:text-foreground">{`“${query}”`}</span>
            </span>
          </CommandItem>
        ) : null}
      </CommandList>
    </Command>
  );

  if (gridMode) return <EditorCard cellWidth={cellWidth}>{list}</EditorCard>;

  return (
    <FormPicker
      open={open}
      onOpenChange={(next) => {
        if (creatingRef.current) return;
        setOpen(next);
        if (!next) setSearch("");
      }}
      label={column.label || undefined}
      error={error}
      display={
        selected ? (
          <>
            <ToneDot option={selected} />
            <span className="sg:truncate">{selected.label}</span>
          </>
        ) : (
          valueLabel
        )
      }
      placeholder="Select or create…"
    >
      {list}
    </FormPicker>
  );
}

export const CreatableSelectPopupEditor = toPopupGridEditor(CreatableSelectEditor);
