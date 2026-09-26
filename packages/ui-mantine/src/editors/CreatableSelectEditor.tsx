import { Combobox, Group, InputBase, Loader, useCombobox } from "@mantine/core";
import { IconPlus } from "../internal/icons";
import { type ChangeEvent, type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import type { Option } from "../internal/core-contracts";
import { type UiEditorProps, toPopupGridEditor } from "../internal/grid-contracts";
import { getSelectOptions, pickableOptions } from "../internal/options";
import { useEditorStyles } from "./EditorCard";
import { OptionColorDot, PickerDivider, PickerEmpty, PickerOption, SearchRow, useEnterPicksHighlighted } from "./pickerParts";

/**
 * Sentinel option value for the trailing "Create '<x>'" entry. Contains a NUL
 * character so it can never collide with a real option value such as "$create".
 */
export const CREATE_OPTION_VALUE = "\u0000$create";

export type CreatableSelectEditorProps = UiEditorProps<string, unknown>;

const errorMessage = (err: unknown): string =>
  err instanceof Error && err.message ? err.message : typeof err === "string" && err ? err : "Could not create option";

/**
 * Searchable single select that can create new options through
 * `dataSource.createOption`. The dropdown stays inside the editor
 * (`withinPortal={false}`) so AG Grid never sees an outside click.
 */
export function CreatableSelectEditor(props: CreatableSelectEditorProps) {
  const { value, onChange, onCommit, onCancel, column, config, dataSource, autoFocus, error, user } = props;
  useEditorStyles();
  // Latest props for async continuations (avoids stale closures after await).
  const latest = useRef(props);
  latest.current = props;
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  // Synchronous guard: state updates are too late to block a second submit.
  const creatingRef = useRef(false);
  const gridMode = autoFocus !== false;
  const [created, setCreated] = useState<Option[]>([]);
  // Options the user may set, plus the current one (locked) — `Option.settableBy` (v0.3).
  const pickable = useMemo(() => {
    const base = getSelectOptions(config);
    const extra = created.filter((c) => !base.some((b) => b.id === c.id));
    return pickableOptions([...base, ...extra], user, value);
  }, [config, created, user, value]);
  const options = useMemo(() => pickable.map((p) => p.option), [pickable]);
  const lockOf = (id: string) => pickable.find((p) => p.option.id === id)?.lockReason ?? null;
  const selected = options.find((o) => o.id === value);
  const valueLabel = selected?.label ?? (value == null || value === "" ? undefined : String(value));

  const [search, setSearch] = useState(gridMode ? "" : (valueLabel ?? ""));
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const combobox = useCombobox({ defaultOpened: gridMode });
  // Store callbacks close over `dropdownOpened`; async code must use the latest store.
  const comboboxRef = useRef(combobox);
  comboboxRef.current = combobox;

  const query = search.trim();
  const isSearching = query !== "" && query !== valueLabel;
  const filtered = isSearching ? options.filter((o) => o.label.toLowerCase().includes(query.toLowerCase())) : options;
  const exactMatch = options.some((o) => o.label.toLowerCase() === query.toLowerCase());
  const canCreate = typeof dataSource?.createOption === "function";
  const showCreate = canCreate && query !== "" && !exactMatch;

  useEffect(() => {
    if (gridMode) inputRef.current?.focus();
  }, [gridMode]);

  // Highlight the first match while searching so Enter picks it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-run when the search changes
  useEffect(() => {
    if (isSearching) combobox.selectFirstOption();
    else combobox.resetSelectedOption();
  }, [search]);

  const pick = (option: Option) => {
    setCreateError(null);
    setSearch(option.label);
    latest.current.onChange(option.id);
    latest.current.onCommit(option.id);
    comboboxRef.current.closeDropdown();
  };

  const create = async (label: string) => {
    const createOption = dataSource?.createOption;
    if (!createOption || creatingRef.current) return;
    creatingRef.current = true;
    setCreating(true);
    setCreateError(null);
    combobox.closeDropdown();
    let option: Option;
    try {
      option = await createOption(column.id, label);
    } catch (err) {
      creatingRef.current = false;
      if (!mounted.current) return;
      setCreating(false);
      setCreateError(errorMessage(err));
      // Stay open: re-open and re-focus once the disabled input is re-enabled.
      setTimeout(() => {
        if (!mounted.current) return;
        comboboxRef.current.openDropdown();
        inputRef.current?.focus();
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

  const handleSubmit = (submitted: string) => {
    if (creatingRef.current) return;
    if (submitted === CREATE_OPTION_VALUE) {
      void create(query);
      return;
    }
    const option = options.find((o) => o.id === submitted);
    if (option) pick(option);
  };

  // Grid mode: pick (or create) the highlighted option before AG Grid sees Enter.
  useEnterPicksHighlighted(inputRef, gridMode, (picked) => handleSubmit(picked));

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onCancel();
      return;
    }
    if (event.key === "Enter" && !(combobox.dropdownOpened && combobox.getSelectedOptionIndex() !== -1)) {
      // No highlighted option: commit the current value unchanged.
      event.preventDefault();
      if (!showCreate) onCommit(value);
    }
  };

  const inputProps = {
    value: search,
    placeholder: valueLabel ?? "Search or create…",
    "aria-label": column.label,
    disabled: creating,
    "aria-busy": creating || undefined,
    onChange: (event: ChangeEvent<HTMLInputElement>) => {
      setSearch(event.currentTarget.value);
      setCreateError(null);
      combobox.openDropdown();
    },
    onKeyDown: handleKeyDown,
  };
  const loader = creating ? <Loader size="xs" aria-label="Creating option" data-testid="creatable-select-loader" /> : null;

  const optionNodes = (
    <>
      {filtered.map((option) =>
        gridMode ? (
          <PickerOption
            key={option.id}
            value={option.id}
            selected={option.id === value}
            disabled={creating || lockOf(option.id) !== null}
            title={lockOf(option.id) ?? undefined}
            leading={<OptionColorDot option={option} />}
          >
            {option.label}
          </PickerOption>
        ) : (
          <Combobox.Option value={option.id} key={option.id} active={option.id === value} disabled={creating || lockOf(option.id) !== null} title={lockOf(option.id) ?? undefined}>
            <Group gap={8} wrap="nowrap">
              <OptionColorDot option={option} />
              <span>{option.label}</span>
            </Group>
          </Combobox.Option>
        ),
      )}
      {showCreate &&
        (gridMode ? (
          <PickerOption
            value={CREATE_OPTION_VALUE}
            disabled={creating}
            aria-label={`Create '${query}'`}
            leading={<IconPlus size={14} stroke={1.75} aria-hidden style={{ flexShrink: 0, color: "var(--mantine-color-dimmed)" }} />}
          >
            <span>
              Create <strong style={{ fontWeight: 500 }}>{query}</strong>
            </span>
          </PickerOption>
        ) : (
          <Combobox.Option value={CREATE_OPTION_VALUE} disabled={creating}>{`Create '${query}'`}</Combobox.Option>
        ))}
    </>
  );

  if (gridMode) {
    // Picker card: search row, hairline, the list attached below (always visible).
    return (
      <Combobox store={combobox} withinPortal={false} onOptionSubmit={handleSubmit} readOnly={creating}>
        <div style={{ width: "var(--sg-ed-width, 100%)" }}>
          <SearchRow right={loader} onMouseDown={() => inputRef.current?.focus()}>
            <Combobox.EventsTarget>
              <input ref={inputRef} className="sg-ed-input" {...inputProps} />
            </Combobox.EventsTarget>
          </SearchRow>
          {(createError ?? error) && (
            <div className="sg-ed-error" role="alert">
              {createError ?? error}
            </div>
          )}
          <PickerDivider />
          <Combobox.Options className="sg-ed-list">
            {optionNodes}
            {filtered.length === 0 && !showCreate && <PickerEmpty>{query ? "No matches" : "No options yet — type to create one"}</PickerEmpty>}
          </Combobox.Options>
        </div>
      </Combobox>
    );
  }

  return (
    <Combobox store={combobox} withinPortal={false} onOptionSubmit={handleSubmit} readOnly={creating}>
      <Combobox.Target>
        <InputBase
          ref={inputRef}
          {...inputProps}
          error={createError ?? error}
          rightSection={loader ?? <Combobox.Chevron />}
          rightSectionPointerEvents="none"
          onClick={() => {
            if (!creatingRef.current) combobox.openDropdown();
          }}
        />
      </Combobox.Target>
      <Combobox.Dropdown>
        <Combobox.Options mah={240} style={{ overflowY: "auto" }}>
          {optionNodes}
          {filtered.length === 0 && !showCreate && <Combobox.Empty>Nothing found</Combobox.Empty>}
        </Combobox.Options>
      </Combobox.Dropdown>
    </Combobox>
  );
}

export const CreatableSelectPopupEditor = toPopupGridEditor(CreatableSelectEditor);
