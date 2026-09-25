import { MultiSelect, useMantineTheme } from "@mantine/core";
import { useEffect, useMemo, useState } from "react";
import type { Option } from "../internal/core-contracts";
import { createPopupEditor } from "../internal/grid-contracts";
import type { UiEditorProps } from "../internal/grid-contracts";
import { getSelectOptions, resolveOptionColor } from "../internal/options";

export interface MultiSelectEditorConfig {
  options?: Option[];
  dynamic?: boolean;
}

function OptionColorDot({ color }: { color: string }) {
  return (
    <span
      data-testid="option-color-dot"
      data-color={color}
      style={{
        display: "inline-block",
        width: 8,
        height: 8,
        borderRadius: "50%",
        marginRight: 8,
        backgroundColor: `var(--mantine-color-${color}-filled)`,
      }}
    />
  );
}

/** Searchable multi-select editor. Commits on Enter or blur rather than on each pick. */
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
}: UiEditorProps<string[], MultiSelectEditorConfig>) {
  const theme = useMantineTheme();
  // Static options follow `config` live (e.g. a column builder adding options); dynamic ones are fetched.
  const configOptions = useMemo(() => getSelectOptions(config), [config]);
  const [fetched, setFetched] = useState<Option[] | null>(null);
  const options = config?.dynamic ? (fetched ?? configOptions) : configOptions;
  const [selected, setSelected] = useState<string[]>(value ?? []);

  const dynamic = config?.dynamic === true;
  useEffect(() => {
    if (!dynamic || !dataSource?.getOptions) return;
    let cancelled = false;
    dataSource.getOptions(column.id).then(
      (opts) => {
        if (!cancelled) setFetched(opts);
      },
      () => {},
    );
    return () => {
      cancelled = true;
    };
  }, [dynamic, dataSource, column.id]);

  return (
    <MultiSelect
      data={options.map((o) => ({ value: o.id, label: o.label }))}
      value={selected}
      error={error}
      searchable
      comboboxProps={{ withinPortal: false }}
      defaultDropdownOpened={autoFocus !== false}
      renderOption={({ option }) => {
        const match = options.find((o) => o.id === option.value);
        return (
          <>
            <OptionColorDot color={resolveOptionColor(match, theme)} />
            {option.label}
          </>
        );
      }}
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

export const MultiSelectPopupEditor = createPopupEditor(MultiSelectEditor);
