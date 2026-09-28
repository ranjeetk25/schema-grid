import { Check, EyeOff } from "lucide-react";
import { useId, useState } from "react";
import type { ColumnPermissions, RoleRule } from "../internal/core-contracts";
import { type PeopleNames, type UserDirectory, usePeopleNames } from "../internal/people";
import { SG_ROOT, cn } from "../lib/cn";
import { ToggleGroup, ToggleGroupItem } from "../ui/toggle-group";
import { PeoplePicker } from "./PeoplePicker";
import { describePermissions, hiddenFromRoles, isEmptyRule, rolesIn, setEditRule, setViewRule, titleCaseRole, usersIn } from "./permissions-model";

export interface PermissionsStepProps {
  value: ColumnPermissions;
  onChange(value: ColumnPermissions): void;
  /** Roles the host knows about; offered as chips. */
  roles: string[];
  /** Formula columns: computed, so nobody can edit — the "Can edit" row is hidden. */
  computed?: boolean;
  /**
   * v0.4: adds a People picker (per-person `users`) under each row's roles.
   * Absent → no People picker; `users` already on a rule are kept untouched.
   */
  userDirectory?: UserDirectory;
  className?: string;
}

const EMPTY_ROLES = "Choose at least one role";
const EMPTY_ROLES_OR_PEOPLE = "Choose at least one role or person";

/** First blocking error (a rule with neither roles nor people), or null. */
export function permissionsError(p: ColumnPermissions): string | null {
  for (const rule of [p.read, p.edit]) {
    if (isEmptyRule(rule)) return EMPTY_ROLES;
  }
  return null;
}

/** True when some role (or person) could edit without being able to read. The UI never produces this (it auto-adjusts). */
export function editNotSubsetOfRead(p: ColumnPermissions): boolean {
  if (p.read === "all") return false;
  if (p.edit === "all") return true;
  const readRoles = rolesIn(p.read);
  const readUsers = usersIn(p.read);
  return rolesIn(p.edit).some((r) => !readRoles.includes(r)) || usersIn(p.edit).some((u) => !readUsers.includes(u));
}

function AccessRow({
  label,
  rule,
  roles,
  directory,
  names,
  onChange,
}: {
  label: "Can view" | "Can edit";
  rule: RoleRule;
  roles: string[];
  directory: UserDirectory | undefined;
  names: PeopleNames;
  onChange(rule: RoleRule): void;
}) {
  const labelId = useId();
  const mode = rule === "all" ? "all" : "roles";
  const selected = rolesIn(rule);
  const users = usersIn(rule);
  // Roles on the rule that the host no longer lists still show, so they can be removed.
  const offered = [...roles, ...selected.filter((r) => !roles.includes(r))];
  const people = label === "Can view" ? "People that can view" : "People that can edit";

  return (
    <div className="sg:flex sg:flex-col sg:gap-2">
      <div className="sg:flex sg:items-center sg:justify-between sg:gap-3">
        <span id={labelId} className="sg:text-sm sg:font-medium sg:text-foreground">
          {label}
        </span>
        <ToggleGroup
          type="single"
          aria-labelledby={labelId}
          value={mode}
          onValueChange={(v) => {
            if (v === "all") onChange("all");
            else if (v === "roles") onChange(rule === "all" ? { roles: [] } : rule);
          }}
        >
          <ToggleGroupItem value="all">Everyone</ToggleGroupItem>
          <ToggleGroupItem value="roles">{directory ? "Only some…" : "Only roles…"}</ToggleGroupItem>
        </ToggleGroup>
      </div>
      {rule !== "all" ? (
        <div className="sg:flex sg:flex-col sg:gap-1.5">
          {offered.length ? (
            <fieldset aria-label={`${label} roles`} className="sg:m-0 sg:flex sg:min-w-0 sg:flex-wrap sg:gap-1.5 sg:border-0 sg:p-0">
              {offered.map((role) => {
                const on = selected.includes(role);
                return (
                  <button
                    key={role}
                    type="button"
                    aria-pressed={on}
                    onClick={() => onChange({ ...rule, roles: on ? selected.filter((r) => r !== role) : [...selected, role] })}
                    className={cn(
                      "sg:inline-flex sg:h-6 sg:items-center sg:gap-1 sg:rounded-full sg:border sg:px-2.5 sg:text-xs sg:font-medium sg:outline-none",
                      "sg:transition-colors sg:duration-150 sg:focus-visible:ring-[3px] sg:focus-visible:ring-ring",
                      on
                        ? "sg:border-primary sg:bg-primary-subtle sg:text-primary"
                        : "sg:border-border sg:text-muted-foreground sg:hover:border-input-hover sg:hover:text-foreground",
                    )}
                  >
                    {on ? <Check aria-hidden className="sg:size-3" /> : null}
                    {titleCaseRole(role)}
                  </button>
                );
              })}
            </fieldset>
          ) : (
            <p className="sg:text-xs sg:text-muted-foreground">This grid has no roles to choose from.</p>
          )}
          {directory ? (
            <PeoplePicker label={people} value={users} onChange={(next) => onChange({ ...rule, users: next })} directory={directory} names={names} />
          ) : users.length ? (
            <p className="sg:text-xs sg:text-muted-foreground">{`Plus ${users.length} specific ${users.length === 1 ? "person" : "people"}`}</p>
          ) : null}
          {isEmptyRule(rule) ? (
            <p role="alert" className="sg:text-xs sg:text-danger">
              {directory ? EMPTY_ROLES_OR_PEOPLE : EMPTY_ROLES}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * "Who can access": Can view / Can edit, each Everyone or specific roles
 * (plus people with a `userDirectory`, v0.4). Editors are always kept a
 * subset of viewers automatically (with a short note).
 */
export function PermissionsStep({ value, onChange, roles, computed = false, userDirectory, className }: PermissionsStepProps) {
  const [note, setNote] = useState<string | null>(null);
  const hidden = hiddenFromRoles(value, roles);
  const names = usePeopleNames(userDirectory, [...usersIn(value.read), ...usersIn(value.edit)]);

  return (
    <div className={cn(SG_ROOT, "sg:flex sg:flex-col sg:gap-4", className)}>
      <AccessRow
        label="Can view"
        rule={value.read}
        roles={roles}
        directory={userDirectory}
        names={names}
        onChange={(read) => {
          const next = setViewRule(value, read, names);
          setNote(next.note);
          onChange(next.value);
        }}
      />
      {computed ? (
        <div className="sg:flex sg:items-center sg:justify-between sg:gap-3">
          <span className="sg:text-sm sg:font-medium sg:text-foreground">Can edit</span>
          <span className="sg:text-xs sg:text-muted-foreground">Computed — read-only for everyone</span>
        </div>
      ) : (
        <AccessRow
          label="Can edit"
          rule={value.edit}
          roles={roles}
          directory={userDirectory}
          names={names}
          onChange={(edit) => {
            const next = setEditRule(value, edit, names);
            setNote(next.note);
            onChange(next.value);
          }}
        />
      )}

      <div className="sg:flex sg:flex-col sg:gap-1.5 sg:rounded-md sg:bg-subtle sg:px-3 sg:py-2.5">
        <p data-testid="permissions-summary" className="sg:text-sm sg:text-foreground">
          {describePermissions(value, { readOnly: computed }, names)}
        </p>
        {hidden.length ? (
          <div className="sg:flex sg:flex-wrap sg:items-center sg:gap-1.5">
            <span className="sg:inline-flex sg:items-center sg:gap-1 sg:text-xs sg:text-muted-foreground">
              <EyeOff aria-hidden className="sg:size-3" />
              Hidden from
            </span>
            <ul aria-label="Hidden from" className="sg:flex sg:flex-wrap sg:gap-1">
              {hidden.map((r) => (
                <li key={r} className="sg:inline-flex sg:h-5 sg:items-center sg:rounded-sm sg:bg-muted sg:px-1.5 sg:text-xs sg:text-muted-foreground">
                  {titleCaseRole(r)}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <p aria-live="polite" className="sg:text-xs sg:text-faint-foreground sg:empty:hidden">
          {note ?? ""}
        </p>
      </div>
    </div>
  );
}
