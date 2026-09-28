import { UserIcon, XIcon } from "lucide-react";
import { useCallback } from "react";
import { AsyncCombobox } from "../editors/AsyncCombobox";
import { UserAvatarLabel } from "../editors/UserPickerEditor";
import type { ActorRef } from "../internal/core-contracts";
import { type PeopleNames, type UserDirectory, rememberPeople } from "../internal/people";
import { cn } from "../lib/cn";
import { Badge } from "../ui/badge";

export interface PeoplePickerProps {
  /** Accessible name of the picker (and of the picked list), e.g. "People that can edit". */
  label: string;
  /** Picked user ids (`RoleRule.users`). */
  value: string[];
  onChange(next: string[]): void;
  directory: UserDirectory;
  /** Resolved names (`usePeopleNames`); unknown ids show as the raw id, marked "unknown user". */
  names: PeopleNames;
}

const nameOf = (p: ActorRef) => p.name?.trim() || p.id;

/**
 * v0.4 People multi-select: picked people as removable pills above an async
 * search over `directory.search` (debounced; picking someone already listed
 * does nothing).
 */
export function PeoplePicker({ label, value, onChange, directory, names }: PeoplePickerProps) {
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
  return (
    <div className="sg:flex sg:flex-col sg:gap-1.5">
      {value.length > 0 ? (
        <ul aria-label={label} className="sg:m-0 sg:flex sg:list-none sg:flex-wrap sg:gap-1 sg:p-0">
          {value.map((id) => {
            const text = pillLabel(id);
            return (
              <li key={id}>
                <Badge variant="outline" className={cn("sg:max-w-full sg:pr-0.5", names.get(id) === null ? "sg:text-muted-foreground" : "sg:text-foreground")}>
                  <UserIcon aria-hidden className="sg:size-3 sg:shrink-0 sg:text-faint-foreground" />
                  <span className="sg:truncate">{text}</span>
                  <button
                    type="button"
                    aria-label={`Remove ${text}`}
                    className="sg:inline-flex sg:size-4 sg:shrink-0 sg:items-center sg:justify-center sg:rounded-xs sg:text-muted-foreground sg:outline-none sg:hover:bg-muted sg:hover:text-foreground sg:focus-visible:ring-2 sg:focus-visible:ring-ring"
                    onClick={() => onChange(value.filter((v) => v !== id))}
                  >
                    <XIcon className="sg:size-3" />
                  </button>
                </Badge>
              </li>
            );
          })}
        </ul>
      ) : null}
      <AsyncCombobox<ActorRef>
        load={load}
        getKey={(p) => p.id}
        getLabel={nameOf}
        renderItem={(p) => <UserAvatarLabel name={nameOf(p)} />}
        onSelect={(p) => {
          if (!value.includes(p.id)) onChange([...value, p.id]);
        }}
        placeholder="Add people…"
        autoFocus={false}
        aria-label={label}
      />
    </div>
  );
}
