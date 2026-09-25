import { Combobox, MultiSelect, useCombobox } from "@mantine/core";
import { IconCheck } from "../internal/icons";
import { useEffect, useRef, useState } from "react";
import type { Option } from "../internal/core-contracts";
import { toPopupGridEditor } from "../internal/grid-contracts";
import type { UiEditorProps } from "../internal/grid-contracts";
import { useEditorStyles } from "./EditorCard";
import { OptionColorDot, PickerDivider, PickerEmpty, PickerOption, PickerPill, SearchRow, useEnterPicksHighlighted } from "./pickerParts";
import { matchesSearch, useSelectOptions } from "./SelectEditor";

export interface MultiSelectEditorConfig {
  options?: Option[];
  dynamic?: boolean;
}

/**
 * Searchable multi-select. In the grid it is a picker card: picked values
 * as pills that wrap inside the card, an inline search input, and the option
 * list attached below; clicking (or Enter on a highlighted option) toggles,
 * Backspace on an empty search removes the last pill, Enter with nothing
 * highlighted (or blur) commits. As a form / filter field it is a Mantine
 * `MultiSelect`.
 */
export function MultiSelectEditor(props: UiEditorProps<string[], MultiSelectEditorConfig>) {
  return props.autoFocus === false ? <MultiSelectField {...props} /> : <MultiSelectPicker {...props} />;
}

function MultiSelectPicker({ value, onChange, onCommit, onCancel, column, config, dataSource }: UiEditorProps<string[], MultiSelectEditorConfig>) {
  useEditorStyles();
  const options = useSelectOptions(config, column.id, dataSource);
  const [selected, setSelected] = useState<string[]>(value ?? []);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const [search, setSearch] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const combobox = useCombobox({ defaultOpened: true });
  const visible = options.filter((o) => matchesSearch(o, search));

  const update = (next: string[]) => {
    selectedRef.current = next;
    setSelected(next);
    onChange(next);
  };
  const toggle = (id: string) => {
    const current = selectedRef.current;
    update(current.includes(id) ? current.filter((v) => v !== id) : [...current, id]);
    setSearch("");
    combobox.resetSelectedOption();
    inputRef.current?.focus();
  };
  useEnterPicksHighlighted(inputRef, true, toggle);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-run when the search changes
  useEffect(() => {
    if (search.trim() !== "") combobox.selectFirstOption();
    else combobox.resetSelectedOption();
  }, [search]);

  const pills = selected.map((id) => {
    const option = options.find((o) => o.id === id);
    const label = option?.label ?? id;
    return <PickerPill key={id} label={label} color={option?.color} onRemove={() => update(selectedRef.current.filter((v) => v !== id))} />;
  });

  return (
    <Combobox store={combobox} onOptionSubmit={toggle} withinPortal={false}>
      <div style={{ width: "var(--sg-ed-width, 100%)" }}>
        <SearchRow pills={pills} showIcon={selected.length === 0} onMouseDown={() => inputRef.current?.focus()}>
          <Combobox.EventsTarget>
            <input
              ref={inputRef}
              className="sg-ed-input"
              value={search}
              placeholder={selected.length === 0 ? "Search…" : "Add…"}
              aria-label={column.label || "Search options"}
              onChange={(event) => {
                setSearch(event.currentTarget.value);
                combobox.openDropdown();
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  onCommit(selectedRef.current);
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  onCancel();
                } else if (event.key === "Backspace" && search === "" && selectedRef.current.length > 0) {
                  update(selectedRef.current.slice(0, -1));
                }
              }}
              onBlur={(event) => {
                // Focus moving within the card (a pill's remove button, an option) is not a blur of the editor.
                const next = event.relatedTarget as Node | null;
                if (next && event.currentTarget.closest(".sg-ed-card, [data-sg-picker]")?.contains(next)) return;
                onCommit(selectedRef.current);
              }}
            />
          </Combobox.EventsTarget>
        </SearchRow>
        <PickerDivider />
        <Combobox.Options className="sg-ed-list" aria-multiselectable>
          {visible.map((o) => (
            <PickerOption key={o.id} value={o.id} selected={selected.includes(o.id)} leading={<OptionColorDot option={o} />}>
              {o.label}
            </PickerOption>
          ))}
          {visible.length === 0 && <PickerEmpty>{options.length === 0 ? "No options yet" : "No matches"}</PickerEmpty>}
        </Combobox.Options>
      </div>
    </Combobox>
  );
}

/** Form / filter mode: a Mantine MultiSelect (dropdown kept inside the component). */
function MultiSelectField({ value, onChange, onCommit, onCancel, column, config, dataSource, error }: UiEditorProps<string[], MultiSelectEditorConfig>) {
  const options = useSelectOptions(config, column.id, dataSource);
  const [selected, setSelected] = useState<string[]>(value ?? []);
  return (
    <MultiSelect
      data={options.map((o) => ({ value: o.id, label: o.label }))}
      value={selected}
      error={error}
      searchable
      comboboxProps={{ withinPortal: false }}
      renderOption={({ option, checked }) => (
        <span style={{ display: "flex", alignItems: "center", gap: 8, width: "100%" }}>
          <OptionColorDot option={options.find((o) => o.id === option.value)} />
          <span style={{ flex: 1 }}>{option.label}</span>
          {checked && <IconCheck size={14} stroke={2} color="var(--mantine-primary-color-filled)" aria-hidden />}
        </span>
      )}
      onChange={(next) => {
        setSelected(next);
        onChange(next);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          onCommit(selected);
        } else if (event.key === "Escape") {
          event.preventDefault();
          onCancel();
        }
      }}
      onBlur={() => onCommit(selected)}
    />
  );
}

export const MultiSelectPopupEditor = toPopupGridEditor(MultiSelectEditor);
