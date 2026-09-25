import { Group, Stack, Text } from "@mantine/core";
import { useCallback, useState } from "react";
import type { LinkRef } from "../internal/core-contracts";
import { type UiEditorProps, toPopupGridEditor } from "../internal/grid-contracts";
import { AsyncCombobox } from "./AsyncCombobox";
import { useEditorStyles } from "./EditorCard";
import { PickerPill } from "./pickerParts";

/** Core link values are always `LinkRef[]`; a lone `LinkRef` is accepted on read. */
export type LinkValue = LinkRef[] | LinkRef;
export type LinkPickerEditorProps = UiEditorProps<LinkValue, unknown>;

const isLinkRef = (v: unknown): v is LinkRef =>
  !!v && typeof v === "object" && typeof (v as LinkRef).id === "string" && typeof (v as LinkRef).label === "string";

/** Core `LinkConfig.multiple` (defaults to true in core). */
const allowsMultiple = (config: unknown): boolean =>
  !(!!config && typeof config === "object" && (config as { multiple?: unknown }).multiple === false);

const toList = (value: LinkValue | null): LinkRef[] =>
  Array.isArray(value) ? value.filter(isLinkRef) : isLinkRef(value) ? [value] : [];

/**
 * Link-to-record picker over `dataSource.lookup(column.id, search)`.
 * Always emits core's `LinkRef[]`. With `config.multiple === false` a pick
 * emits and commits `[link]`; otherwise picks accumulate as removable pills
 * and Enter on an empty search commits the list.
 */
export function LinkPickerEditor({ value, onChange, onCommit, onCancel, column, config, dataSource, autoFocus, error }: LinkPickerEditorProps) {
  useEditorStyles();
  const multiple = allowsMultiple(config);
  const lookup = dataSource?.lookup;
  const [picked, setPicked] = useState<LinkRef[]>(() => toList(value));

  const load = useCallback(
    (search: string): Promise<LinkRef[]> => (lookup ? lookup(column.id, search) : Promise.resolve([])),
    [lookup, column.id],
  );

  if (!lookup) {
    const current = toList(value);
    return (
      <Stack gap={4}>
        {current.length > 0 && <Text size="sm">{current.map((l) => l.label).join(", ")}</Text>}
        <Text size="xs" c="dimmed" px={8} py={4}>
          Lookup not configured
        </Text>
      </Stack>
    );
  }

  const update = (next: LinkRef[]) => {
    setPicked(next);
    onChange(next);
  };

  const pills =
    multiple && picked.length > 0 ? (
      <Group gap={4} data-testid="link-picker-pills">
        {picked.map((link) => (
          <PickerPill key={link.id} label={link.label} onRemove={() => update(picked.filter((p) => p.id !== link.id))} />
        ))}
      </Group>
    ) : null;

  const single = !multiple ? toList(value)[0] : undefined;

  return (
    <AsyncCombobox<LinkRef>
      load={load}
      getKey={(l) => l.id}
      getLabel={(l) => l.label}
      value={single?.id ?? null}
      valueLabel={single?.label}
      onSelect={(link) => {
        if (!multiple) {
          onChange([link]);
          onCommit([link]);
          return;
        }
        if (picked.some((p) => p.id === link.id)) return;
        update([...picked, link]);
      }}
      onSubmitEmpty={(search) => {
        if (search.trim() !== "") return;
        onCommit(multiple ? picked : toList(value));
      }}
      onCancel={onCancel}
      placeholder="Search records…"
      autoFocus={autoFocus}
      error={error}
      aria-label={column.label}
      header={multiple ? pills : undefined}
    />
  );
}

export const LinkPickerPopupEditor = toPopupGridEditor(LinkPickerEditor);
