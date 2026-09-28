import type { ColumnPermissions, RoleRule } from "../internal/core-contracts";
import { type PeopleNames, peopleList } from "../internal/people";

/** "counsellor" / "sales_lead" → "Counsellor" / "Sales Lead". */
export function titleCaseRole(role: string): string {
  return role
    .replace(/[_-]+/g, " ")
    .trim()
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

const listRoles = (roles: string[]) => roles.map(titleCaseRole).join(", ");

/** "Admin, Counsellor", "Finance Team and Priya, Rahul", "Admin and 5 people" (v0.4 people named via `names`). */
function listWho(roles: string[], users: string[], names?: PeopleNames): string {
  const people = peopleList(users, names);
  if (!people) return listRoles(roles);
  return roles.length ? `${listRoles(roles)} and ${people}` : people;
}

const dedupe = (roles: string[]) => [...new Set(roles)];

type ListRule = Exclude<RoleRule, "all">;
export const rolesIn = (rule: RoleRule): string[] => (rule === "all" ? [] : (rule.roles ?? []));
export const usersIn = (rule: RoleRule): string[] => (rule === "all" ? [] : (rule.users ?? []));
/** A restricted rule naming neither roles nor people (= nobody). */
export const isEmptyRule = (rule: RoleRule): boolean => rule !== "all" && rolesIn(rule).length === 0 && usersIn(rule).length === 0;

/** Deduped lists, keeping exactly the keys the rule had (a `users` key is never invented). */
const normalize = (rule: ListRule): ListRule => ({
  ...(rule.roles ? { roles: dedupe(rule.roles) } : {}),
  ...(rule.users ? { users: dedupe(rule.users) } : {}),
});

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));

export interface PermissionsUpdate {
  value: ColumnPermissions;
  /** Plain-English note about an automatic adjustment, e.g. "Added Counsellor to Can view". */
  note: string | null;
}

/**
 * Sets who can view, trimming "Can edit" so editors are always viewers
 * (edit ⊆ view is enforced here, never shown as an error). v0.4: people
 * (`users`) follow the same rules as roles.
 */
export function setViewRule(current: ColumnPermissions, view: RoleRule, names?: PeopleNames): PermissionsUpdate {
  if (view === "all") return { value: { ...current, read: "all" }, note: null };
  const read = normalize(view);
  const viewRoles = rolesIn(read);
  const viewUsers = usersIn(read);
  // "Everyone can edit" — or editors exactly matching the viewers — keeps following the viewers.
  const mirrors =
    current.edit === "all" ||
    (current.read !== "all" &&
      sameSet(rolesIn(current.edit), rolesIn(current.read)) &&
      sameSet(usersIn(current.edit), usersIn(current.read)));
  const droppedRoles = rolesIn(current.edit).filter((r) => !viewRoles.includes(r));
  const droppedUsers = usersIn(current.edit).filter((u) => !viewUsers.includes(u));
  const note = droppedRoles.length || droppedUsers.length ? `Removed ${listWho(droppedRoles, droppedUsers, names)} from Can edit` : null;
  if (mirrors) return { value: { read, edit: { ...read } }, note };
  const edit = current.edit as ListRule;
  return {
    value: {
      read,
      edit: {
        ...(edit.roles ? { roles: edit.roles.filter((r) => viewRoles.includes(r)) } : {}),
        ...(edit.users ? { users: edit.users.filter((u) => viewUsers.includes(u)) } : {}),
      },
    },
    note,
  };
}

/** Sets who can edit, widening "Can view" so every editor (role or person) can also see the column. */
export function setEditRule(current: ColumnPermissions, edit: RoleRule, names?: PeopleNames): PermissionsUpdate {
  if (edit === "all") {
    return {
      value: { read: "all", edit: "all" },
      note: current.read === "all" ? null : "Can view set to Everyone",
    };
  }
  const next = normalize(edit);
  if (current.read === "all") return { value: { read: "all", edit: next }, note: null };
  const readRoles = rolesIn(current.read);
  const readUsers = usersIn(current.read);
  const missingRoles = rolesIn(next).filter((r) => !readRoles.includes(r));
  const missingUsers = usersIn(next).filter((u) => !readUsers.includes(u));
  return {
    value: {
      read: {
        ...current.read,
        ...(missingRoles.length ? { roles: [...readRoles, ...missingRoles] } : {}),
        ...(missingUsers.length ? { users: [...readUsers, ...missingUsers] } : {}),
      },
      edit: next,
    },
    note: missingRoles.length || missingUsers.length ? `Added ${listWho(missingRoles, missingUsers, names)} to Can view` : null,
  };
}

const ruleSubject = (rule: RoleRule, names?: PeopleNames) =>
  rule === "all" ? "Everyone" : isEmptyRule(rule) ? "No one yet" : `Only ${listWho(rolesIn(rule), usersIn(rule), names)}`;

/**
 * "Everyone can view · Only Admin, Counsellor can edit"; v0.4 people read
 * "Only Finance Team and Priya, Rahul" (names from `names`, else raw ids;
 * "N people" beyond 3). Formula columns are read-only.
 */
export function describePermissions(p: ColumnPermissions, { readOnly = false }: { readOnly?: boolean } = {}, names?: PeopleNames): string {
  const view = `${ruleSubject(p.read, names)} can view`;
  if (readOnly) return `${view} · Computed, read-only for everyone`;
  return `${view} · ${ruleSubject(p.edit, names)} can edit`;
}

/** Roles from `roles` that cannot view the column. */
export function hiddenFromRoles(p: ColumnPermissions, roles: string[]): string[] {
  if (p.read === "all") return [];
  const readRoles = rolesIn(p.read);
  return roles.filter((r) => !readRoles.includes(r));
}
