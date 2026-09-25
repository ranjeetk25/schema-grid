import { Avatar, Group, Text } from "@mantine/core";
import { useCallback } from "react";
import type { Option, UserRef } from "../internal/core-contracts";
import { type UiEditorProps, createPopupEditor } from "../internal/grid-contracts";
import { AsyncCombobox } from "./AsyncCombobox";

/** Stored as the user id; a `UserRef` object is accepted on read. */
export type UserPickerEditorProps = UiEditorProps<string | UserRef, unknown>;

const valueId = (v: string | UserRef | null): string | null => (v == null ? null : typeof v === "string" ? v : v.id);

export function UserAvatarLabel({ name, avatarUrl }: { name: string; avatarUrl?: string }) {
  return (
    <Group gap={8} wrap="nowrap">
      <Avatar src={avatarUrl ?? null} name={name} alt={name} size={22} radius="xl" color="initials" />
      <Text size="sm" truncate>
        {name}
      </Text>
    </Group>
  );
}

/** Async user search over `dataSource.getOptions(column.id, search)`. Emits the user id. */
export function UserPickerEditor({ value, onChange, onCommit, onCancel, column, dataSource, autoFocus, error }: UserPickerEditorProps) {
  const getOptions = dataSource?.getOptions;
  const load = useCallback(
    (search: string): Promise<Option[]> => (getOptions ? getOptions(column.id, search) : Promise.resolve([])),
    [getOptions, column.id],
  );
  const id = valueId(value);
  return (
    <AsyncCombobox<Option>
      load={load}
      getKey={(o) => o.value}
      getLabel={(o) => o.label}
      renderItem={(o) => <UserAvatarLabel name={o.label} avatarUrl={o.avatarUrl} />}
      value={id}
      valueLabel={value != null && typeof value === "object" ? value.name : undefined}
      onSelect={(o) => {
        onChange(o.value);
        onCommit(o.value);
      }}
      onCancel={onCancel}
      onSubmitEmpty={() => onCommit(value)}
      placeholder="Search users…"
      autoFocus={autoFocus}
      error={error}
      aria-label={column.label}
    />
  );
}

export const UserPickerPopupEditor = createPopupEditor(UserPickerEditor);
