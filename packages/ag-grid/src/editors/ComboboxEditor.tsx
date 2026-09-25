import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { GridRow, LinkRef, Option } from "../internal/core";
import { getSchemaGridContext } from "../grid/gridContext";
import { createPopupEditor, type PopupEditorInnerProps } from "./createPopupEditor";
import { columnOptions } from "./SelectEditor";

/** `cellEditorParams` the combobox understands (AG Grid spreads them into the editor props). */
export interface ComboboxEditorParams {
  /** Select several values (stored as an array). Default: `config.multiple === true`. */
  multiple?: boolean;
  /** Offer a "Create “x”" row. Default: true for creatableSelect, else false. */
  creatable?: boolean;
  /** Replaces the default option source (dataSource.getOptions / lookup / static config.options). */
  loadOptions?(search: string): Promise<Array<Option | LinkRef>>;
  /** Search debounce in ms. Default 150. */
  debounceMs?: number;
}

type StoredValue = string | LinkRef;

interface Item {
  key: string;
  label: string;
  value: StoredValue;
}

type Entry = { kind: "item"; item: Item } | { kind: "create"; label: string };

const DEFAULT_DEBOUNCE_MS = 150;

function isOption(x: Option | LinkRef): x is Option {
  return typeof (x as Partial<Option>).value === "string";
}

function toItem(x: Option | LinkRef): Item {
  if (isOption(x)) return { key: x.value, label: x.label, value: x.value };
  return { key: x.id, label: x.label, value: { id: x.id, label: x.label } };
}

function keyOf(v: unknown): string | undefined {
  if (typeof v === "string") return v;
  if (v && typeof v === "object" && typeof (v as Partial<LinkRef>).id === "string") return (v as LinkRef).id;
  return undefined;
}

function isPrintableKey(key: string | null | undefined): key is string {
  return typeof key === "string" && key.length === 1;
}

type ComboboxInnerProps = PopupEditorInnerProps<GridRow, unknown> & ComboboxEditorParams;

function ComboboxInner(props: ComboboxInnerProps): JSX.Element {
  const { schemaColumn, fieldType, editorProps } = props;
  const columnId = schemaColumn?.id ?? editorProps.column?.getColId?.() ?? "";
  const columnType = schemaColumn?.type;
  const config = schemaColumn?.config ?? fieldType?.defaultConfig;
  const multiple = props.multiple ?? (config as { multiple?: unknown } | undefined)?.multiple === true;
  const creatable = props.creatable ?? columnType === "creatableSelect";
  const debounceMs = props.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const gridContext = getSchemaGridContext(editorProps.context);

  const listboxId = useId();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [search, setSearch] = useState<string>(() => (isPrintableKey(editorProps.eventKey) ? editorProps.eventKey : ""));
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(-1);
  const [creating, setCreating] = useState(false);

  // Latest loader inputs, read inside the (debounced) effect without re-triggering it.
  const loaderRef = useRef({ loadOptions: props.loadOptions, gridContext, columnId, columnType, config });
  loaderRef.current = { loadOptions: props.loadOptions, gridContext, columnId, columnType, config };
  const requestRef = useRef(0);
  const firstLoadRef = useRef(true);

  const load = useCallback(
    async (term: string): Promise<void> => {
      const request = ++requestRef.current;
      const { loadOptions, gridContext: ctx, columnId: id, columnType: type, config: cfg } = loaderRef.current;
      const ds = ctx?.dataSource;
      setLoading(true);
      try {
        let raw: Array<Option | LinkRef>;
        if (loadOptions) raw = await loadOptions(term);
        else if (type === "link") raw = ds?.lookup ? await ds.lookup(id, term) : [];
        else if (ds?.getOptions) raw = await ds.getOptions(id, term);
        else {
          const s = term.toLowerCase();
          raw = columnOptions(cfg).filter((o) => o.label.toLowerCase().includes(s));
        }
        if (request !== requestRef.current) return;
        setItems(raw.map(toItem));
        setActive(multiple ? -1 : 0);
      } catch {
        if (request === requestRef.current) setItems([]);
      } finally {
        if (request === requestRef.current) setLoading(false);
      }
    },
    [multiple],
  );

  useEffect(() => {
    const delay = firstLoadRef.current ? 0 : debounceMs;
    firstLoadRef.current = false;
    if (delay <= 0) {
      void load(search);
      return;
    }
    setLoading(true);
    const timer = setTimeout(() => void load(search), delay);
    return () => clearTimeout(timer);
  }, [search, debounceMs, load]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const trimmed = search.trim();
  const entries = useMemo<Entry[]>(() => {
    const list: Entry[] = items.map((item) => ({ kind: "item", item }));
    const lower = trimmed.toLowerCase();
    if (creatable && trimmed && !items.some((i) => i.label.toLowerCase() === lower)) {
      list.push({ kind: "create", label: trimmed });
    }
    return list;
  }, [items, creatable, trimmed]);

  const selectedKeys = useMemo(() => {
    if (multiple) return new Set((Array.isArray(props.value) ? props.value : []).map(keyOf).filter((k): k is string => !!k));
    const k = keyOf(props.value);
    return new Set(k ? [k] : []);
  }, [multiple, props.value]);

  const currentList = (): StoredValue[] => (Array.isArray(props.value) ? (props.value as StoredValue[]) : []);

  const choose = (item: Item): void => {
    if (!multiple) {
      props.commit(item.value);
      return;
    }
    const list = currentList();
    const next = selectedKeys.has(item.key) ? list.filter((v) => keyOf(v) !== item.key) : [...list, item.value];
    props.onChange(next.length > 0 ? next : null);
  };

  const create = async (label: string): Promise<void> => {
    if (creating) return;
    setCreating(true);
    const ds = gridContext?.dataSource;
    try {
      const option: Option = ds?.createOption ? await ds.createOption(columnId, label) : { value: label, label };
      gridContext?.events()?.onOptionCreate?.(columnId, option);
      const item = toItem(option);
      setItems((prev) => (prev.some((i) => i.key === item.key) ? prev : [...prev, item]));
      if (multiple) {
        setSearch("");
        const list = currentList();
        props.onChange(selectedKeys.has(item.key) ? list : [...list, item.value]);
      } else {
        props.commit(item.value);
      }
    } finally {
      setCreating(false);
    }
  };

  const activate = (entry: Entry): void => {
    if (entry.kind === "create") void create(entry.label);
    else choose(entry.item);
  };

  const optionId = (index: number): string => `${listboxId}-opt-${index}`;
  const activeEntry = active >= 0 ? entries[active] : undefined;

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        e.stopPropagation();
        if (entries.length > 0) setActive((a) => Math.min(entries.length - 1, a + 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        e.stopPropagation();
        if (entries.length > 0) setActive((a) => Math.max(0, a - 1));
        break;
      case "Enter":
        e.preventDefault();
        e.stopPropagation();
        if (activeEntry) activate(activeEntry);
        else props.commit(props.value);
        break;
      case "Escape":
        e.preventDefault();
        e.stopPropagation();
        props.cancel();
        break;
      default:
        break;
    }
  };

  return (
    <div className="sg-combobox-editor">
      <input
        ref={inputRef}
        className="sg-cell-editor sg-combobox-input"
        type="text"
        role="combobox"
        aria-label={schemaColumn?.label}
        aria-autocomplete="list"
        aria-expanded={true}
        aria-controls={listboxId}
        aria-activedescendant={activeEntry ? optionId(active) : undefined}
        aria-busy={loading || creating}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        onKeyDown={onKeyDown}
      />
      {loading ? (
        <div className="sg-combobox-loading" role="status">
          Loading…
        </div>
      ) : null}
      <div
        id={listboxId}
        className="sg-combobox-listbox"
        role="listbox"
        aria-label={schemaColumn?.label}
        aria-multiselectable={multiple || undefined}
      >
        {entries.map((entry, index) => {
          const isActive = index === active;
          const selected = entry.kind === "item" && selectedKeys.has(entry.item.key);
          return (
            <div
              key={entry.kind === "item" ? `i:${entry.item.key}` : "create"}
              id={optionId(index)}
              role="option"
              aria-selected={selected}
              className={[
                "sg-combobox-option",
                entry.kind === "create" ? "sg-combobox-create" : "",
                isActive ? "sg-combobox-option-active" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(index)}
              onClick={() => activate(entry)}
            >
              {entry.kind === "create" ? `Create “${entry.label}”` : entry.item.label}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const comboboxPopup = createPopupEditor<unknown, GridRow, ComboboxEditorParams>(ComboboxInner, { position: "under" });

/**
 * Popup combobox editor for creatableSelect, user and link columns (our
 * Community replacement for a rich select). Options come from
 * `cellEditorParams.loadOptions`, else `dataSource.lookup` (link) /
 * `dataSource.getOptions`, else static `config.options`; the data source is
 * read from AG Grid's `context` (`SchemaGridContext`). Link values are stored
 * as `LinkRef`, everything else as the option's `value`.
 */
export const ComboboxEditor = comboboxPopup.component;
