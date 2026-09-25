import { Select, useMantineTheme } from "@mantine/core";
import { useEffect, useMemo, useRef, useState } from "react";
import { getSelectOptions, resolveOptionColor } from "../internal/options";
import { toPopupGridEditor } from "../internal/grid-contracts";
import type { UiEditorProps } from "../internal/grid-contracts";
import type { Option } from "../internal/core-contracts";

export interface SelectEditorConfig {
  options?: Option[];
  dynamic?: boolean;
}

/** A coloured dot matching an option's configured colour. */
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

/** Searchable single-select editor. Options come from config, or `dataSource.getOptions` when the config is dynamic. */
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
}: UiEditorProps<string, SelectEditorConfig>) {
  const theme = useMantineTheme();
  // Static options follow `config` live (e.g. a column builder adding options); dynamic ones are fetched.
  const configOptions = useMemo(() => getSelectOptions(config), [config]);
  const [fetched, setFetched] = useState<Option[] | null>(null);
  const options = config?.dynamic ? (fetched ?? configOptions) : configOptions;

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

  // Grid mode: AG Grid forwards Enter from a popup editor to the grid (a
  // native listener on an ancestor, which runs before React's delegated
  // handlers), ending the edit with the old value. When an option is
  // highlighted, pick it here at the input and keep Enter from the grid.
  const inputRef = useRef<HTMLInputElement>(null);
  const commitRef = useRef({ onChange, onCommit });
  commitRef.current = { onChange, onCommit };
  const gridMode = autoFocus !== false;
  useEffect(() => {
    const input = inputRef.current;
    if (!gridMode || !input) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Enter") return;
      const activeId = input.getAttribute("aria-activedescendant");
      const picked = activeId
        ? input.ownerDocument.getElementById(activeId)?.getAttribute("value")
        : null;
      if (!picked) return;
      event.preventDefault();
      event.stopPropagation();
      commitRef.current.onChange(picked);
      commitRef.current.onCommit(picked);
    };
    input.addEventListener("keydown", onKeyDown);
    return () => input.removeEventListener("keydown", onKeyDown);
  }, [gridMode]);

  return (
    <Select
      ref={inputRef}
      data={options.map((o) => ({ value: o.id, label: o.label }))}
      value={value}
      error={error}
      searchable
      comboboxProps={{ withinPortal: false }}
      // Grid mode: focus the input so arrow keys / typing reach the combobox
      // (otherwise the popup wrapper keeps focus and the list is mouse-only).
      autoFocus={autoFocus !== false}
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
