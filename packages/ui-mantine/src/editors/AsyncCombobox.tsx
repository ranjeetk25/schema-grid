import { Combobox, Group, InputBase, Loader, Stack, Text, useCombobox } from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import { type ChangeEvent, type KeyboardEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { useEditorStyles } from "./EditorCard";
import { PickerDivider, PickerEmpty, PickerOption, SearchRow, useEnterPicksHighlighted } from "./pickerParts";

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
}

type LoadState = "idle" | "loading" | "done" | "error";

const errorText = (err: unknown): string =>
  err instanceof Error && err.message ? err.message : typeof err === "string" && err ? err : "Something went wrong";

/**
 * Debounced async search combobox. The dropdown stays inside the component
 * (`withinPortal={false}`). Responses from superseded requests are dropped.
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
}: AsyncComboboxProps<TItem>) {
  useEditorStyles();
  const gridMode = autoFocus !== false;
  const [search, setSearch] = useState("");
  const [debounced] = useDebouncedValue(search, debounceMs);
  const [activated, setActivated] = useState(gridMode && !readOnly);
  const [items, setItems] = useState<TItem[]>([]);
  const [state, setState] = useState<LoadState>("idle");
  const [loadError, setLoadError] = useState<string | null>(null);
  const requestId = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const loadRef = useRef(load);
  loadRef.current = load;

  const combobox = useCombobox({
    defaultOpened: gridMode && !readOnly,
    onDropdownOpen: () => setActivated(true),
  });

  useEffect(() => {
    if (gridMode && !readOnly) inputRef.current?.focus();
  }, [gridMode, readOnly]);

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

  // Highlight the first result while searching so Enter picks it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-run when results change
  useEffect(() => {
    if (search.trim() !== "" && items.length > 0) combobox.selectFirstOption();
    else combobox.resetSelectedOption();
  }, [items]);

  const selectedLabel = (() => {
    if (value == null) return undefined;
    const found = items.find((i) => getKey(i) === value);
    return found ? getLabel(found) : undefined;
  })();

  const handleSubmit = (key: string) => {
    const item = items.find((i) => getKey(i) === key);
    if (!item) return;
    setSearch("");
    onSelect(item);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onCancel?.();
      return;
    }
    if (event.key === "Enter" && !(combobox.dropdownOpened && combobox.getSelectedOptionIndex() !== -1)) {
      event.preventDefault();
      onSubmitEmpty?.(search);
    }
  };

  const status = (() => {
    if (state === "error") {
      return (
        <Text size="xs" c="red">
          {`Could not load: ${loadError}`}
        </Text>
      );
    }
    if (items.length > 0) return null;
    if (state === "loading" || state === "idle") return "Loading…";
    return "No results";
  })();

  // Grid mode: pick the highlighted item before AG Grid sees Enter.
  useEnterPicksHighlighted(inputRef, gridMode && !readOnly && !disabled, handleSubmit);

  const inputProps = {
    value: search,
    placeholder: selectedLabel ?? valueLabel ?? placeholder,
    "aria-label": ariaLabel,
    disabled,
    readOnly,
    onChange: (event: ChangeEvent<HTMLInputElement>) => {
      setSearch(event.currentTarget.value);
      combobox.openDropdown();
    },
    onKeyDown: handleKeyDown,
  };

  if (gridMode) {
    // Picker card: header (e.g. picked pills), search row, hairline, list attached below.
    return (
      <Combobox store={combobox} withinPortal={false} onOptionSubmit={handleSubmit} readOnly={readOnly || disabled}>
        <div style={{ width: "var(--sg-ed-width, 100%)" }}>
          {header != null && <div style={{ padding: "4px 4px 0" }}>{header}</div>}
          <SearchRow
            right={state === "loading" ? <Loader size={12} aria-label="Loading" /> : null}
            onMouseDown={() => inputRef.current?.focus()}
          >
            <Combobox.EventsTarget>
              <input ref={inputRef} className="sg-ed-input" {...inputProps} />
            </Combobox.EventsTarget>
          </SearchRow>
          {error && (
            <div className="sg-ed-error" role="alert">
              {error}
            </div>
          )}
          <PickerDivider />
          <Combobox.Options className="sg-ed-list">
            {items.map((item) => {
              const key = getKey(item);
              return (
                <PickerOption key={key} value={key} selected={key === value}>
                  {renderItem ? renderItem(item) : getLabel(item)}
                </PickerOption>
              );
            })}
            {status != null && (
              <Combobox.Empty>
                <PickerEmpty>{status}</PickerEmpty>
              </Combobox.Empty>
            )}
          </Combobox.Options>
        </div>
      </Combobox>
    );
  }

  const box = (
    <Combobox store={combobox} withinPortal={false} onOptionSubmit={handleSubmit} readOnly={readOnly || disabled}>
      <Combobox.Target>
        <InputBase
          ref={inputRef}
          {...inputProps}
          error={error}
          rightSection={state === "loading" ? <Loader size="xs" /> : <Combobox.Chevron />}
          rightSectionPointerEvents="none"
          onClick={() => {
            if (!readOnly) combobox.openDropdown();
          }}
        />
      </Combobox.Target>
      <Combobox.Dropdown>
        <Combobox.Options mah={240} style={{ overflowY: "auto" }}>
          {items.map((item) => {
            const key = getKey(item);
            return (
              <Combobox.Option value={key} key={key} active={key === value}>
                {renderItem ? renderItem(item) : <Group gap={8}>{getLabel(item)}</Group>}
              </Combobox.Option>
            );
          })}
          {status != null && <Combobox.Empty>{status}</Combobox.Empty>}
        </Combobox.Options>
      </Combobox.Dropdown>
    </Combobox>
  );
  if (header === undefined) return box;
  return (
    <Stack gap={6}>
      {header}
      {box}
    </Stack>
  );
}
