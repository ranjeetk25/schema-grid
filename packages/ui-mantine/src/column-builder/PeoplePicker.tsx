import { Group } from "@mantine/core";
import { useCallback } from "react";
import { AsyncCombobox } from "../editors/AsyncCombobox";
import { UserAvatarLabel } from "../editors/UserPickerEditor";
import { PickerPill } from "../editors/pickerParts";
import type { ActorRef } from "../internal/core-contracts";
import { type PeopleNames, type UserDirectory, rememberPeople } from "../internal/people";

export interface PeoplePickerProps {
  /** Accessible name of the search input, e.g. "People that can edit". */
  label: string;
  /** Picked user ids (`RoleRule.users`). */
  value: string[];
  onChange(next: string[]): void;
  directory: UserDirectory;
  /** Resolved names (`usePeopleNames`); unknown ids show as the raw id, marked "unknown user". */
  names: PeopleNames;
  "data-testid"?: string;
}

const nameOf = (p: ActorRef) => p.name?.trim() || p.id;

/**
 * v0.4 People multi-select: picked people as removable pills above an async
 * search over `directory.search` (debounced; picking someone already listed
 * does nothing).
 */
export function PeoplePicker({ label, value, onChange, directory, names, "data-testid": testId }: PeoplePickerProps) {
  const load = useCallback(
    async (query: string) => {
      const people = await directory.search(query);
      rememberPeople(directory, people);
      return people;
    },
    [directory],
  );
  const pillLabel = (id: string) => {
    const name = names.get(id);
    return name === null ? `${id} (unknown user)` : (name ?? id);
  };
  const pills =
    value.length > 0 ? (
      <Group gap={4} data-testid={testId}>
        {value.map((id) => (
          <PickerPill key={id} label={pillLabel(id)} onRemove={() => onChange(value.filter((v) => v !== id))} />
        ))}
      </Group>
    ) : null;
  return (
    <AsyncCombobox<ActorRef>
      load={load}
      getKey={(p) => p.id}
      getLabel={nameOf}
      renderItem={(p) => <UserAvatarLabel name={nameOf(p)} />}
      onSelect={(p) => {
        if (!value.includes(p.id)) onChange([...value, p.id]);
      }}
      placeholder="Search people…"
      autoFocus={false}
      aria-label={label}
      header={pills}
    />
  );
}
