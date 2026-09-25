import { useRef, useState } from "react";
import type { Option } from "../internal/core-contracts";
import { toPopupGridEditor } from "../internal/grid-contracts";
import type { UiEditorProps } from "../internal/grid-contracts";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "../ui/command";
import { EditorCard, FormPicker, OptionRowContent, ToneDot } from "./EditorCard";
import { isGridMode, useCmdkEnter, useCmdkHighlight, useElement } from "./useEditorKeys";
import { filterOptions, optionItemValue, useSelectOptions } from "./useSelectOptions";

export interface SelectEditorConfig {
  options?: Option[];
  dynamic?: boolean;
}

/**
 * Searchable single-select editor. Options come from config, or
 * `dataSource.getOptions` when the config is dynamic.
 *
 * Grid mode: an opaque card with the search input and the option list
 * inline (AG Grid's popup layer hosts it). Arrows move the highlight, typing
 * filters (and highlights the first match), Enter / click picks and commits,
 * Escape cancels. Form / filter mode: a 32px trigger + portalled popover.
 */
export function SelectEditor({
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
}: UiEditorProps<string, SelectEditorConfig>) {
  const options = useSelectOptions(config, dataSource, column);
  const gridMode = isGridMode(autoFocus);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const searchRef = useRef(search);
  searchRef.current = search;
  const highlight = useCmdkHighlight(() => searchRef.current.trim() !== "");
  const [root, setRoot] = useElement<HTMLDivElement>();
  useCmdkEnter(root);

  const filtered = filterOptions(options, search);
  const selected = options.find((o) => o.id === value);

  const pick = (option: Option) => {
    onChange(option.id);
    onCommit(option.id);
    setOpen(false);
    setSearch("");
  };

  const list = (
    <Command ref={setRoot} shouldFilter={false} label={column.label || "Options"} loop {...highlight.rootProps}>
      <CommandInput
        autoFocus={gridMode}
        value={search}
        onValueChange={setSearch}
        placeholder="Search…"
        aria-invalid={error ? true : undefined}
        onKeyDown={(event) => {
          if (event.key === "Escape" && gridMode) {
            event.preventDefault();
            onCancel();
          }
        }}
      />
      <CommandList {...highlight.listProps}>
        <CommandEmpty>No options</CommandEmpty>
        {filtered.map((option) => (
          <CommandItem key={option.id} value={optionItemValue(option.id)} onSelect={() => pick(option)}>
            <OptionRowContent option={option} selected={option.id === value} />
          </CommandItem>
        ))}
      </CommandList>
    </Command>
  );

  if (gridMode) {
    return (
      <EditorCard cellWidth={cellWidth}>
        {list}
        {error ? <p className="sg:border-t sg:border-border sg:px-2.5 sg:py-1.5 sg:text-xs sg:text-danger">{error}</p> : null}
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
        selected ? (
          <>
            <ToneDot option={selected} />
            <span className="sg:truncate">{selected.label}</span>
          </>
        ) : value ? (
          <span className="sg:truncate">{value}</span>
        ) : undefined
      }
    >
      {list}
    </FormPicker>
  );
}

export const SelectPopupEditor = toPopupGridEditor(SelectEditor);
