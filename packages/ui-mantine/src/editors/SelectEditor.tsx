import { Combobox, Select, useCombobox, useMantineTheme } from "@mantine/core";
import { IconCheck } from "../internal/icons";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Option } from "../internal/core-contracts";
import { toPopupGridEditor } from "../internal/grid-contracts";
import type { UiEditorProps } from "../internal/grid-contracts";
import { getSelectOptions, resolveOptionColor } from "../internal/options";
import { useEditorStyles } from "./EditorCard";
import { OptionColorDot, PickerDivider, PickerEmpty, PickerOption, SearchRow, useEnterPicksHighlighted } from "./pickerParts";

export interface SelectEditorConfig {
  options?: Option[];
  dynamic?: boolean;
}

/** Static options follow `config` live (e.g. a column builder adding options); dynamic ones are fetched once. */
export function useSelectOptions(config: SelectEditorConfig | undefined, columnId: string, dataSource: UiEditorProps["dataSource"]): Option[] {
  const configOptions = useMemo(() => getSelectOptions(config), [config]);
  const [fetched, setFetched] = useState<Option[] | null>(null);
  const dynamic = config?.dynamic === true;
  useEffect(() => {
    if (!dynamic || !dataSource?.getOptions) return;
    let cancelled = false;
    dataSource.getOptions(columnId).then(
      (opts) => {
        if (!cancelled) setFetched(opts);
      },
      () => {},
    );
    return () => {
      cancelled = true;
    };
  }, [dynamic, dataSource, columnId]);
  return dynamic ? (fetched ?? configOptions) : configOptions;
}

export const matchesSearch = (option: Option, search: string): boolean =>
  search.trim() === "" || option.label.toLowerCase().includes(search.trim().toLowerCase());

/**
 * Searchable single-select. In the grid (`autoFocus !== false`) it is a
 * picker card: a borderless search row, a hairline and the option list
 * attached below (no floating dropdown). As a form / filter field it is a
 * regular Mantine `Select`. Options come from config, or
 * `dataSource.getOptions` when the config is dynamic.
 */
export function SelectEditor(props: UiEditorProps<string, SelectEditorConfig>) {
  return props.autoFocus === false ? <SelectField {...props} /> : <SelectPicker {...props} />;
}

function SelectPicker({ value, onChange, onCommit, onCancel, column, config, dataSource }: UiEditorProps<string, SelectEditorConfig>) {
  useEditorStyles();
  const options = useSelectOptions(config, column.id, dataSource);
  const [search, setSearch] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const combobox = useCombobox({ defaultOpened: true });
  const visible = options.filter((o) => matchesSearch(o, search));
  const current = options.find((o) => o.id === value);

  const pick = (id: string) => {
    onChange(id);
    onCommit(id);
  };
  useEnterPicksHighlighted(inputRef, true, pick);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Highlight the first match while searching so Enter picks it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-run when the search changes
  useEffect(() => {
    if (search.trim() !== "") combobox.selectFirstOption();
    else combobox.resetSelectedOption();
  }, [search]);

  return (
    <Combobox store={combobox} onOptionSubmit={pick} withinPortal={false}>
      <div style={{ width: "var(--sg-ed-width, 100%)" }}>
        <SearchRow onMouseDown={() => inputRef.current?.focus()}>
          <Combobox.EventsTarget>
            <input
              ref={inputRef}
              className="sg-ed-input"
              value={search}
              placeholder={current ? current.label : "Search…"}
              aria-label={column.label || "Search options"}
              onChange={(event) => {
                setSearch(event.currentTarget.value);
                combobox.openDropdown();
              }}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  onCancel();
                }
              }}
            />
          </Combobox.EventsTarget>
        </SearchRow>
        <PickerDivider />
        <Combobox.Options className="sg-ed-list">
          {visible.map((o) => (
            <PickerOption key={o.id} value={o.id} selected={o.id === value} leading={<OptionColorDot option={o} />}>
              {o.label}
            </PickerOption>
          ))}
          {visible.length === 0 && <PickerEmpty>{options.length === 0 ? "No options yet" : "No matches"}</PickerEmpty>}
        </Combobox.Options>
      </div>
    </Combobox>
  );
}

/** Form / filter mode: a regular Mantine Select (dropdown kept inside the component). */
function SelectField({ value, onChange, onCommit, onCancel, column, config, dataSource, error }: UiEditorProps<string, SelectEditorConfig>) {
  const theme = useMantineTheme();
  const options = useSelectOptions(config, column.id, dataSource);
  return (
    <Select
      data={options.map((o) => ({ value: o.id, label: o.label }))}
      value={value}
      error={error}
      searchable
      comboboxProps={{ withinPortal: false }}
      renderOption={({ option, checked }) => {
        const match = options.find((o) => o.id === option.value);
        return (
          <span style={{ display: "flex", alignItems: "center", gap: 8, width: "100%" }}>
            <OptionColorDot option={match ?? { id: option.value, label: option.label, color: resolveOptionColor(match, theme) }} />
            <span style={{ flex: 1 }}>{option.label}</span>
            {checked && <IconCheck size={14} stroke={2} color="var(--mantine-primary-color-filled)" aria-hidden />}
          </span>
        );
      }}
      onChange={(next) => {
        onChange(next);
        if (next !== null) onCommit(next);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onCancel();
        }
      }}
    />
  );
}

export const SelectPopupEditor = toPopupGridEditor(SelectEditor);
