import { Box, Combobox, Group, InputBase, Loader, useCombobox, useMantineTheme } from "@mantine/core";
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import type { Option } from "../internal/core-contracts";
import { type UiEditorProps, createPopupEditor } from "../internal/grid-contracts";
import { getSelectOptions, resolveOptionColor } from "../internal/options";

/**
 * Sentinel option value for the trailing "Create '<x>'" entry. Contains a NUL
 * character so it can never collide with a real option value such as "$create".
 */
export const CREATE_OPTION_VALUE = "\u0000$create";

export type CreatableSelectEditorProps = UiEditorProps<string, unknown>;

const errorMessage = (err: unknown): string =>
  err instanceof Error && err.message ? err.message : typeof err === "string" && err ? err : "Could not create option";

function OptionDot({ option }: { option: Option }) {
  const theme = useMantineTheme();
  const color = resolveOptionColor(option, theme);
  const background = color in theme.colors ? `var(--mantine-color-${color}-filled)` : color;
  return <Box component="span" w={8} h={8} style={{ borderRadius: "50%", background, flexShrink: 0 }} />;
}

/**
 * Searchable single select that can create new options through
 * `dataSource.createOption`. The dropdown stays inside the editor
 * (`withinPortal={false}`) so AG Grid never sees an outside click.
 */
export function CreatableSelectEditor(props: CreatableSelectEditorProps) {
  const { value, onChange, onCommit, onCancel, column, config, dataSource, autoFocus, error } = props;
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
  const options = useMemo(() => {
    const base = getSelectOptions(config);
    const extra = created.filter((c) => !base.some((b) => b.id === c.id));
    return [...base, ...extra];
  }, [config, created]);
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

  return (
    <Combobox store={combobox} withinPortal={false} onOptionSubmit={handleSubmit} readOnly={creating}>
      <Combobox.Target>
        <InputBase
          ref={inputRef}
          value={search}
          placeholder={valueLabel ?? "Search or create…"}
          aria-label={column.label}
          disabled={creating}
          aria-busy={creating || undefined}
          error={createError ?? error}
          rightSection={creating ? <Loader size="xs" aria-label="Creating option" data-testid="creatable-select-loader" /> : <Combobox.Chevron />}
          rightSectionPointerEvents="none"
          onChange={(event) => {
            setSearch(event.currentTarget.value);
            setCreateError(null);
            combobox.openDropdown();
          }}
          onClick={() => {
            if (!creatingRef.current) combobox.openDropdown();
          }}
          onFocus={() => {
            if (gridMode) combobox.openDropdown();
          }}
          onKeyDown={handleKeyDown}
        />
      </Combobox.Target>
      <Combobox.Dropdown>
        <Combobox.Options mah={240} style={{ overflowY: "auto" }}>
          {filtered.map((option) => (
            <Combobox.Option value={option.id} key={option.id} active={option.id === value} disabled={creating}>
              <Group gap={8} wrap="nowrap">
                <OptionDot option={option} />
                <span>{option.label}</span>
              </Group>
            </Combobox.Option>
          ))}
          {showCreate && <Combobox.Option value={CREATE_OPTION_VALUE} disabled={creating}>{`Create '${query}'`}</Combobox.Option>}
          {filtered.length === 0 && !showCreate && <Combobox.Empty>Nothing found</Combobox.Empty>}
        </Combobox.Options>
      </Combobox.Dropdown>
    </Combobox>
  );
}

export const CreatableSelectPopupEditor = createPopupEditor(CreatableSelectEditor);
