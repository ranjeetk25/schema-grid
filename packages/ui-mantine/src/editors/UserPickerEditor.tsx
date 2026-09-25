import { Avatar, Group, Text } from "@mantine/core";
import { useCallback } from "react";
import type { UserOption, UserRef } from "../internal/core-contracts";
import { type UiEditorProps, toPopupGridEditor } from "../internal/grid-contracts";
import { AsyncCombobox } from "./AsyncCombobox";

/** Stored as a core `UserRef` `{id, name}`; a bare id string is accepted on read. */
export type UserPickerEditorProps = UiEditorProps<UserRef | string, unknown>;

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

/** Async user search over `dataSource.getOptions(column.id, search)`. Emits a `UserRef` `{id, name}`. */
export function UserPickerEditor({ value, onChange, onCommit, onCancel, column, dataSource, autoFocus, error }: UserPickerEditorProps) {
  const getOptions = dataSource?.getOptions;
  const load = useCallback(
    (search: string): Promise<UserOption[]> => (getOptions ? getOptions(column.id, search) : Promise.resolve([])),
    [getOptions, column.id],
  );
  const id = valueId(value);
  return (
    <AsyncCombobox<UserOption>
      load={load}
      getKey={(o) => o.id}
      getLabel={(o) => o.label}
      renderItem={(o) => <UserAvatarLabel name={o.label} avatarUrl={o.avatarUrl} />}
      value={id}
      valueLabel={value != null && typeof value === "object" ? value.name : undefined}
      onSelect={(o) => {
        const ref: UserRef = { id: o.id, name: o.label };
        onChange(ref);
        onCommit(ref);
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

export const UserPickerPopupEditor = toPopupGridEditor(UserPickerEditor);
