import type { ColumnPermissions, RoleRule } from "../internal/core-contracts";

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

const dedupe = (roles: string[]) => [...new Set(roles)];

export interface PermissionsUpdate {
  value: ColumnPermissions;
  /** Plain-English note about an automatic adjustment, e.g. "Added Counsellor to Can view". */
  note: string | null;
}

/**
 * Sets who can view, trimming "Can edit" so editors are always viewers
 * (edit ⊆ view is enforced here, never shown as an error).
 */
export function setViewRule(current: ColumnPermissions, view: RoleRule): PermissionsUpdate {
  if (view === "all") return { value: { ...current, read: "all" }, note: null };
  const viewRoles = dedupe(view.roles);
  // "Everyone can edit" — or editors exactly matching the viewers — keeps following the viewers.
  const mirrors =
    current.edit === "all" ||
    (current.read !== "all" &&
      current.edit.roles.length === current.read.roles.length &&
      current.edit.roles.every((r) => (current.read as { roles: string[] }).roles.includes(r)));
  if (mirrors) {
    const dropped = current.edit === "all" ? [] : current.edit.roles.filter((r) => !viewRoles.includes(r));
    return {
      value: { read: { roles: viewRoles }, edit: { roles: viewRoles } },
      note: dropped.length ? `Removed ${listRoles(dropped)} from Can edit` : null,
    };
  }
  const edit = current.edit as { roles: string[] };
  const kept = edit.roles.filter((r) => viewRoles.includes(r));
  const removed = edit.roles.filter((r) => !viewRoles.includes(r));
  return {
    value: { read: { roles: viewRoles }, edit: { roles: kept } },
    note: removed.length ? `Removed ${listRoles(removed)} from Can edit` : null,
  };
}

/** Sets who can edit, widening "Can view" so every editor can also see the column. */
export function setEditRule(current: ColumnPermissions, edit: RoleRule): PermissionsUpdate {
  if (edit === "all") {
    return {
      value: { read: "all", edit: "all" },
      note: current.read === "all" ? null : "Can view set to Everyone",
    };
  }
  const editRoles = dedupe(edit.roles);
  if (current.read === "all") return { value: { read: "all", edit: { roles: editRoles } }, note: null };
  const missing = editRoles.filter((r) => !(current.read as { roles: string[] }).roles.includes(r));
  return {
    value: { read: { roles: [...current.read.roles, ...missing] }, edit: { roles: editRoles } },
    note: missing.length ? `Added ${listRoles(missing)} to Can view` : null,
  };
}

const ruleSubject = (rule: RoleRule) => (rule === "all" ? "Everyone" : rule.roles.length ? `Only ${listRoles(rule.roles)}` : "No one yet");

/** "Everyone can view · Only Admin, Counsellor can edit". Formula columns are read-only. */
export function describePermissions(p: ColumnPermissions, { readOnly = false }: { readOnly?: boolean } = {}): string {
  const view = `${ruleSubject(p.read)} can view`;
  if (readOnly) return `${view} · Computed, read-only for everyone`;
  return `${view} · ${ruleSubject(p.edit)} can edit`;
}

/** Roles from `roles` that cannot view the column. */
export function hiddenFromRoles(p: ColumnPermissions, roles: string[]): string[] {
  if (p.read === "all") return [];
  const readRoles = p.read.roles;
  return roles.filter((r) => !readRoles.includes(r));
}
