import { XIcon } from "lucide-react";
import { useRef, useState } from "react";
import type { Option } from "../internal/core-contracts";
import { toPopupGridEditor } from "../internal/grid-contracts";
import type { UiEditorProps } from "../internal/grid-contracts";
import { optionToneStyle } from "../internal/options";
import { cn } from "../lib/cn";
import { Badge } from "../ui/badge";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "../ui/command";
import { CardHint, EditorCard, FormPicker, OptionRowContent } from "./EditorCard";
import { isGridMode, pickHighlightedItem, useCmdkHighlight, useElement, useNativeKeyDown } from "./useEditorKeys";
import { filterOptions, optionItemValue, useSelectOptions } from "./useSelectOptions";

export interface MultiSelectEditorConfig {
  options?: Option[];
  dynamic?: boolean;
}

/** A removable tone pill for a picked value. */
function SelectedPill({ option, onRemove }: { option: Option; onRemove?: () => void }) {
  return (
    <Badge variant="tone" style={optionToneStyle(option)} className={cn("sg:max-w-full", onRemove && "sg:pr-0.5")}>
      <span className="sg:truncate">{option.label}</span>
      {onRemove ? (
        <button
          type="button"
          aria-label={`Remove ${option.label}`}
          className="sg:inline-flex sg:size-4 sg:shrink-0 sg:items-center sg:justify-center sg:rounded-xs sg:opacity-60 sg:outline-none sg:hover:bg-[color-mix(in_srgb,currentColor_14%,transparent)] sg:hover:opacity-100 sg:focus-visible:ring-2 sg:focus-visible:ring-ring"
          onClick={onRemove}
        >
          <XIcon className="sg:size-3" />
        </button>
      ) : null}
    </Badge>
  );
}

/**
 * Searchable multi-select editor. Selected values show as pills that WRAP at
 * the top of the card; the search input and the option list sit inline under
 * them. Click / Enter toggles the highlighted option (Enter never reaches the
 * grid), Enter with nothing highlighted — or Cmd/Ctrl+Enter — commits,
 * Backspace on an empty search removes the last value, Escape cancels.
 * Every toggle is reported through `onChange`, so the grid's own Tab /
 * click-away commit keeps it too.
 */
export function MultiSelectEditor({
  value,
  onChange,
  onCommit,
  onCancel,
  column,
  config,
  dataSource,
  autoFocus,
  error,
  cellWidth,
}: UiEditorProps<string[], MultiSelectEditorConfig>) {
  const options = useSelectOptions(config, dataSource, column);
  const gridMode = isGridMode(autoFocus);
  const [selected, setSelected] = useState<string[]>(value ?? []);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const searchRef = useRef(search);
  searchRef.current = search;
  const highlight = useCmdkHighlight(() => searchRef.current.trim() !== "");
  const [root, setRoot] = useElement<HTMLDivElement>();
  const keyboardPick = useRef(false);

  const update = (next: string[]) => {
    selectedRef.current = next;
    setSelected(next);
    onChange(next);
  };
  const toggle = (id: string) => {
    const current = selectedRef.current;
    update(current.includes(id) ? current.filter((v) => v !== id) : [...current, id]);
    // A pointer pick drops the highlight so Enter afterwards commits; a keyboard pick keeps it.
    if (!keyboardPick.current) highlight.clear();
  };

  useNativeKeyDown(root, (event) => {
    if (event.key !== "Enter" || event.isComposing || !root) return;
    if (event.metaKey || event.ctrlKey) {
      event.preventDefault();
      event.stopPropagation();
      onCommit(selectedRef.current);
      setOpen(false);
      return;
    }
    keyboardPick.current = true;
    const picked = pickHighlightedItem(root);
    keyboardPick.current = false;
    if (picked) {
      event.preventDefault();
      event.stopPropagation();
    }
  });

  const byId = new Map(options.map((o) => [o.id, o]));
  const selectedOptions = selected.map((id) => byId.get(id) ?? { id, label: id });
  const filtered = filterOptions(options, search);

  const pills =
    selectedOptions.length > 0 ? (
      <div data-testid="multi-select-pills" className="sg:flex sg:flex-wrap sg:gap-1 sg:border-b sg:border-border sg:px-2 sg:py-2">
        {selectedOptions.map((option) => (
          <SelectedPill key={option.id} option={option} onRemove={() => update(selectedRef.current.filter((v) => v !== option.id))} />
        ))}
      </div>
    ) : null;

  const list = (
    <Command ref={setRoot} shouldFilter={false} label={column.label || "Options"} loop {...highlight.rootProps}>
      {pills}
      <CommandInput
        autoFocus={gridMode}
        value={search}
        onValueChange={setSearch}
        placeholder={selected.length > 0 ? "Add more…" : "Search…"}
        aria-invalid={error ? true : undefined}
        onKeyDown={(event) => {
          if (event.key === "Escape" && gridMode) {
            event.preventDefault();
            onCancel();
          } else if (event.key === "Enter" && !event.defaultPrevented) {
            onCommit(selectedRef.current);
          } else if (event.key === "Backspace" && search === "" && selectedRef.current.length > 0) {
            update(selectedRef.current.slice(0, -1));
          }
        }}
      />
      <CommandList {...highlight.listProps}>
        <CommandEmpty>No options</CommandEmpty>
        {filtered.map((option) => (
          <CommandItem key={option.id} value={optionItemValue(option.id)} onSelect={() => toggle(option.id)}>
            <OptionRowContent option={option} selected={selected.includes(option.id)} />
          </CommandItem>
        ))}
      </CommandList>
    </Command>
  );

  if (gridMode) {
    return (
      <EditorCard cellWidth={cellWidth} className="sg:max-w-[min(420px,calc(100vw-32px))]">
        {list}
        {error ? <p className="sg:border-t sg:border-border sg:px-2.5 sg:py-1.5 sg:text-xs sg:text-danger">{error}</p> : null}
        <CardHint>
          <span>↵ toggle</span>
          <span aria-hidden>·</span>
          <span>⌘↵ done</span>
          <span aria-hidden>·</span>
          <span>esc cancel</span>
        </CardHint>
      </EditorCard>
    );
  }

  return (
    <FormPicker
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setSearch("");
      }}
      label={column.label || undefined}
      error={error}
      display={
        selectedOptions.length > 0 ? (
          <span className="sg:flex sg:min-w-0 sg:items-center sg:gap-1 sg:overflow-hidden sg:whitespace-nowrap">
            {selectedOptions.slice(0, 3).map((option) => (
              <SelectedPill key={option.id} option={option} />
            ))}
            {selectedOptions.length > 3 ? <Badge variant="neutral">{`+${selectedOptions.length - 3}`}</Badge> : null}
          </span>
        ) : undefined
      }
    >
      {list}
    </FormPicker>
  );
}

export const MultiSelectPopupEditor = toPopupGridEditor(MultiSelectEditor);
