import { useCallback } from "react";
import type { UserOption, UserRef } from "../internal/core-contracts";
import { type UiEditorProps, toPopupGridEditor } from "../internal/grid-contracts";
import { cn } from "../lib/cn";
import { Avatar } from "../ui/avatar";
import { AsyncCombobox } from "./AsyncCombobox";

/** Stored as a core `UserRef` `{id, name}`; a bare id string is accepted on read. */
export type UserPickerEditorProps = UiEditorProps<UserRef | string, unknown>;

const valueId = (v: string | UserRef | null): string | null => (v == null ? null : typeof v === "string" ? v : v.id);

/** Avatar (image, or tinted initials) + name, on one truncating line. */
export function UserAvatarLabel({ name, avatarUrl, className }: { name: string; avatarUrl?: string; className?: string }) {
  return (
    <span className={cn("sg:flex sg:min-w-0 sg:items-center sg:gap-2", className)}>
      <Avatar name={name} src={avatarUrl ?? null} size="sm" />
      <span className="sg:truncate sg:text-sm">{name}</span>
    </span>
  );
}

/** Async user search over `dataSource.getOptions(column.id, search)`. Emits a `UserRef` `{id, name}`. */
export function UserPickerEditor({ value, onChange, onCommit, onCancel, column, dataSource, autoFocus, error, cellWidth }: UserPickerEditorProps) {
  const getOptions = dataSource?.getOptions;
  const load = useCallback(
    (search: string): Promise<UserOption[]> => (getOptions ? getOptions(column.id, search) : Promise.resolve([])),
    [getOptions, column.id],
  );
  const id = valueId(value);
  const name = value != null && typeof value === "object" ? (value.name ?? value.id) : (value ?? undefined);
  return (
    <AsyncCombobox<UserOption>
      load={load}
      getKey={(o) => o.id}
      getLabel={(o) => o.label}
      renderItem={(o) => <UserAvatarLabel name={o.label} avatarUrl={o.avatarUrl} />}
      value={id}
      valueLabel={value != null && typeof value === "object" ? value.name : undefined}
      display={name ? <UserAvatarLabel name={name} /> : undefined}
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
      cellWidth={cellWidth}
    />
  );
}

export const UserPickerPopupEditor = toPopupGridEditor(UserPickerEditor);
