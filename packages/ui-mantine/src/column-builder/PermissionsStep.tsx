import { Badge, Group, MultiSelect, SegmentedControl, Stack, Text } from "@mantine/core";
import { useState } from "react";
import type { ColumnPermissions, RoleRule } from "../internal/core-contracts";
import { type PeopleNames, type UserDirectory, peopleList, usePeopleNames } from "../internal/people";
import { PeoplePicker } from "./PeoplePicker";

export interface AccessSectionProps {
  value: ColumnPermissions;
  onChange(value: ColumnPermissions): void;
  roles: string[];
  /** Formula columns are computed: nobody edits them, so only "Can view" is shown. */
  computed?: boolean;
  /**
   * v0.4: adds a People picker (per-person `users`) beside each roles picker.
   * Absent → no People picker; `users` already on a rule are kept untouched.
   */
  userDirectory?: UserDirectory;
}
/** @deprecated Use `AccessSectionProps`. */
export type PermissionsStepProps = AccessSectionProps;

const EMPTY_ROLES = "Pick at least one role";
const EMPTY_ROLES_OR_PEOPLE = "Pick at least one role or person";

const rolesIn = (rule: RoleRule): string[] => (rule === "all" ? [] : (rule.roles ?? []));
const usersIn = (rule: RoleRule): string[] => (rule === "all" ? [] : (rule.users ?? []));
const isEmptyRule = (rule: RoleRule) => rule !== "all" && rolesIn(rule).length === 0 && usersIn(rule).length === 0;

/** First blocking error (a rule with neither roles nor people), or null. */
export function permissionsError(p: ColumnPermissions): string | null {
  for (const rule of [p.read, p.edit]) {
    if (isEmptyRule(rule)) return EMPTY_ROLES;
  }
  return null;
}

/** True when some role (or person) could edit without being able to view. */
export function editNotSubsetOfRead(p: ColumnPermissions): boolean {
  if (p.read === "all") return false;
  if (p.edit === "all") return false; // "everyone who can view"
  const readRoles = rolesIn(p.read);
  const readUsers = usersIn(p.read);
  return rolesIn(p.edit).some((r) => !readRoles.includes(r)) || usersIn(p.edit).some((u) => !readUsers.includes(u));
}

/** "counsellor" → "Counsellor", "finance_team" → "Finance team". */
export function roleLabel(role: string): string {
  const words = role.replace(/[_-]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const list = (roles: string[]) => {
  const labels = roles.map(roleLabel);
  if (labels.length <= 1) return labels.join("");
  return `${labels.slice(0, -1).join(", ")} and ${labels.at(-1)}`;
};

/** "Admin", "Finance team and Priya, Rahul", "Admin, Finance team and 5 people" (people named via `names`). */
function whoList(roles: string[], users: string[], names?: PeopleNames): string {
  const people = peopleList(users, names);
  if (!people) return list(roles);
  if (roles.length === 0) return people;
  return `${roles.map(roleLabel).join(", ")} and ${people}`;
}

const ruleWho = (rule: RoleRule, names?: PeopleNames) => whoList(rolesIn(rule), usersIn(rule), names);

/**
 * One plain-English line, e.g. "Everyone can view · Only Admin can edit";
 * per-person rules read "only Finance team and Priya, Rahul can edit" (names
 * from `names`, else raw ids; "N people" beyond 3).
 */
export function accessSummary(p: ColumnPermissions, computed = false, names?: PeopleNames): string {
  const view = p.read === "all" ? "Everyone can view" : isEmptyRule(p.read) ? "Nobody can view yet" : `Only ${ruleWho(p.read, names)} can view`;
  if (computed) return `${view} · computed, so nobody edits it`;
  const edit =
    p.edit === "all"
      ? p.read === "all"
        ? "everyone can edit"
        : "all of them can edit"
      : isEmptyRule(p.edit)
        ? "nobody can edit yet"
        : `only ${ruleWho(p.edit, names)} can edit`;
  return `${view} · ${edit}`;
}

function RuleRow({
  title,
  rule,
  roles,
  everyoneLabel,
  onChange,
  pickerLabel,
  peopleLabel,
  directory,
  names,
}: {
  title: string;
  rule: RoleRule;
  roles: string[];
  everyoneLabel: string;
  pickerLabel: string;
  peopleLabel: string;
  directory: UserDirectory | undefined;
  names: PeopleNames;
  onChange(rule: RoleRule): void;
}) {
  const mode = rule === "all" ? "all" : "roles";
  const users = usersIn(rule);
  return (
    <Stack gap={6}>
      <Group justify="space-between" wrap="nowrap" gap="sm">
        <Text size="sm">{title}</Text>
        <SegmentedControl
          aria-label={title}
          size="xs"
          value={mode}
          onChange={(v) => onChange(v === "all" ? "all" : rule === "all" ? { roles: [] } : rule)}
          data={[
            { value: "all", label: everyoneLabel },
            { value: "roles", label: directory ? "Only some…" : "Only roles…" },
          ]}
        />
      </Group>
      {rule !== "all" && (
        <MultiSelect
          aria-label={pickerLabel}
          placeholder="Pick roles"
          data={roles.map((r) => ({ value: r, label: roleLabel(r) }))}
          value={rolesIn(rule)}
          onChange={(next) => onChange({ ...rule, roles: next })}
          error={isEmptyRule(rule) ? (directory ? EMPTY_ROLES_OR_PEOPLE : EMPTY_ROLES) : undefined}
          searchable
          comboboxProps={{ withinPortal: false }}
        />
      )}
      {rule !== "all" && directory && (
        <PeoplePicker
          label={peopleLabel}
          value={users}
          onChange={(next) => onChange({ ...rule, users: next })}
          directory={directory}
          names={names}
          data-testid={`people-${title.toLowerCase().replace(/\s+/g, "-")}`}
        />
      )}
      {rule !== "all" && !directory && users.length > 0 && (
        <Text size="xs" c="dimmed">
          {`Plus ${users.length} specific ${users.length === 1 ? "person" : "people"}`}
        </Text>
      )}
    </Stack>
  );
}

/**
 * "Who can access": two rows — Can view / Can edit — each "Everyone" or
 * "Only roles…" (plus a People picker with a `userDirectory`, v0.4), a
 * plain-English summary, and "Hidden from" chips. Editing never outruns
 * viewing: giving a role or person edit also gives them view, and taking
 * view away also takes edit (a muted note says so). Maps 1:1 onto the core
 * `ColumnPermissions` (`read` = view, `edit` = edit; edit "all" means
 * everyone who can view).
 */
export function AccessSection({ value, onChange, roles, computed = false, userDirectory }: AccessSectionProps) {
  const [note, setNote] = useState<string | null>(null);
  const names = usePeopleNames(userDirectory, [...usersIn(value.read), ...usersIn(value.edit)]);

  const setView = (read: RoleRule) => {
    let edit = value.edit;
    let msg: string | null = null;
    if (read !== "all" && edit !== "all") {
      const droppedRoles = rolesIn(edit).filter((r) => !rolesIn(read).includes(r));
      const droppedUsers = usersIn(edit).filter((u) => !usersIn(read).includes(u));
      if (droppedRoles.length || droppedUsers.length) {
        edit = {
          ...edit,
          ...(edit.roles ? { roles: edit.roles.filter((r) => !droppedRoles.includes(r)) } : {}),
          ...(edit.users ? { users: edit.users.filter((u) => !droppedUsers.includes(u)) } : {}),
        };
        msg = `${whoList(droppedRoles, droppedUsers, names)} can no longer edit either, since they can't view it.`;
      }
    }
    setNote(msg);
    onChange({ read, edit });
  };

  const setEdit = (edit: RoleRule) => {
    let read = value.read;
    let msg: string | null = null;
    if (read !== "all" && edit !== "all") {
      const addedRoles = rolesIn(edit).filter((r) => !rolesIn(read).includes(r));
      const addedUsers = usersIn(edit).filter((u) => !usersIn(read).includes(u));
      if (addedRoles.length || addedUsers.length) {
        read = {
          ...read,
          ...(addedRoles.length ? { roles: [...rolesIn(read), ...addedRoles] } : {}),
          ...(addedUsers.length ? { users: [...usersIn(read), ...addedUsers] } : {}),
        };
        msg = `${whoList(addedRoles, addedUsers, names)} can now view it too, since editors need to see it.`;
      }
    }
    setNote(msg);
    onChange({ read, edit });
  };

  const readRoles = value.read === "all" ? null : rolesIn(value.read);
  const editRoles = value.edit === "all" ? null : rolesIn(value.edit);
  const hiddenFrom = readRoles ? roles.filter((r) => !readRoles.includes(r)) : [];
  const viewOnly = computed || !editRoles ? [] : roles.filter((r) => !hiddenFrom.includes(r) && !editRoles.includes(r));

  return (
    <Stack gap="sm">
      <RuleRow
        title="Can view"
        rule={value.read}
        roles={roles}
        everyoneLabel="Everyone"
        pickerLabel="Roles that can view"
        peopleLabel="People that can view"
        directory={userDirectory}
        names={names}
        onChange={setView}
      />
      {computed ? (
        <Text size="xs" c="dimmed">
          Computed — read-only for everyone.
        </Text>
      ) : (
        <RuleRow
          title="Can edit"
          rule={value.edit}
          roles={roles}
          everyoneLabel={value.read === "all" ? "Everyone" : "Everyone who can view"}
          pickerLabel="Roles that can edit"
          peopleLabel="People that can edit"
          directory={userDirectory}
          names={names}
          onChange={setEdit}
        />
      )}
      <Text size="xs" c="dimmed" data-testid="access-summary">
        {accessSummary(value, computed, names)}
      </Text>
      {(hiddenFrom.length > 0 || viewOnly.length > 0) && (
        <Group gap={6}>
          {hiddenFrom.length > 0 && (
            <Badge variant="light" color="gray" radius="sm" size="md" styles={{ root: { textTransform: "none", fontWeight: 500 } }}>
              {`Hidden from: ${hiddenFrom.map(roleLabel).join(", ")}`}
            </Badge>
          )}
          {viewOnly.length > 0 && (
            <Badge variant="light" color="gray" radius="sm" size="md" styles={{ root: { textTransform: "none", fontWeight: 500 } }}>
              {`View only: ${viewOnly.map(roleLabel).join(", ")}`}
            </Badge>
          )}
        </Group>
      )}
      {note && (
        <Text size="xs" c="dimmed" component="output" display="block">
          {note}
        </Text>
      )}
    </Stack>
  );
}

/** @deprecated Renamed to `AccessSection` (the column panel's "Who can access" section). */
export const PermissionsStep = AccessSection;
