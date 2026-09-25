import { Badge, Group, MultiSelect, SegmentedControl, Stack, Text } from "@mantine/core";
import { useState } from "react";
import type { ColumnPermissions, RoleRule } from "../internal/core-contracts";

export interface AccessSectionProps {
  value: ColumnPermissions;
  onChange(value: ColumnPermissions): void;
  roles: string[];
  /** Formula columns are computed: nobody edits them, so only "Can view" is shown. */
  computed?: boolean;
}
/** @deprecated Use `AccessSectionProps`. */
export type PermissionsStepProps = AccessSectionProps;

const EMPTY_ROLES = "Pick at least one role";

/** First blocking error (an empty role list), or null. */
export function permissionsError(p: ColumnPermissions): string | null {
  for (const rule of [p.read, p.edit]) {
    if (rule !== "all" && rule.roles.length === 0) return EMPTY_ROLES;
  }
  return null;
}

/** True when some role could edit without being able to view. */
export function editNotSubsetOfRead(p: ColumnPermissions): boolean {
  if (p.read === "all") return false;
  if (p.edit === "all") return false; // "everyone who can view"
  const readRoles = p.read.roles;
  return p.edit.roles.some((r) => !readRoles.includes(r));
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

/** One plain-English line, e.g. "Everyone can view · Only Admin can edit". */
export function accessSummary(p: ColumnPermissions, computed = false): string {
  const view = p.read === "all" ? "Everyone can view" : p.read.roles.length ? `Only ${list(p.read.roles)} can view` : "Nobody can view yet";
  if (computed) return `${view} · computed, so nobody edits it`;
  const edit =
    p.edit === "all"
      ? p.read === "all"
        ? "everyone can edit"
        : "all of them can edit"
      : p.edit.roles.length
        ? `only ${list(p.edit.roles)} can edit`
        : "nobody can edit yet";
  return `${view} · ${edit}`;
}

function RuleRow({
  title,
  rule,
  roles,
  everyoneLabel,
  onChange,
  pickerLabel,
}: {
  title: string;
  rule: RoleRule;
  roles: string[];
  everyoneLabel: string;
  pickerLabel: string;
  onChange(rule: RoleRule): void;
}) {
  const mode = rule === "all" ? "all" : "roles";
  return (
    <Stack gap={6}>
      <Group justify="space-between" wrap="nowrap" gap="sm">
        <Text size="sm">{title}</Text>
        <SegmentedControl
          aria-label={title}
          size="xs"
          value={mode}
          onChange={(v) => onChange(v === "all" ? "all" : { roles: rule === "all" ? [] : rule.roles })}
          data={[
            { value: "all", label: everyoneLabel },
            { value: "roles", label: "Only roles…" },
          ]}
        />
      </Group>
      {rule !== "all" && (
        <MultiSelect
          aria-label={pickerLabel}
          placeholder="Pick roles"
          data={roles.map((r) => ({ value: r, label: roleLabel(r) }))}
          value={rule.roles}
          onChange={(next) => onChange({ roles: next })}
          error={rule.roles.length === 0 ? EMPTY_ROLES : undefined}
          searchable
          comboboxProps={{ withinPortal: false }}
        />
      )}
    </Stack>
  );
}

/**
 * "Who can access": two rows — Can view / Can edit — each "Everyone" or
 * "Only roles…", a plain-English summary, and "Hidden from" chips. Editing
 * never outruns viewing: giving a role edit also gives it view, and taking
 * view away also takes edit (a muted note says so). Maps 1:1 onto the core
 * `ColumnPermissions` (`read` = view, `edit` = edit; edit "all" means
 * everyone who can view).
 */
export function AccessSection({ value, onChange, roles, computed = false }: AccessSectionProps) {
  const [note, setNote] = useState<string | null>(null);

  const setView = (read: RoleRule) => {
    let edit = value.edit;
    let msg: string | null = null;
    if (read !== "all" && edit !== "all") {
      const dropped = edit.roles.filter((r) => !read.roles.includes(r));
      if (dropped.length) {
        edit = { roles: edit.roles.filter((r) => read.roles.includes(r)) };
        msg = `${list(dropped)} can no longer edit either, since they can't view it.`;
      }
    }
    setNote(msg);
    onChange({ read, edit });
  };

  const setEdit = (edit: RoleRule) => {
    let read = value.read;
    let msg: string | null = null;
    if (read !== "all" && edit !== "all") {
      const viewers = read.roles;
      const added = edit.roles.filter((r) => !viewers.includes(r));
      if (added.length) {
        read = { roles: [...viewers, ...added] };
        msg = `${list(added)} can now view it too, since editors need to see it.`;
      }
    }
    setNote(msg);
    onChange({ read, edit });
  };

  const readRoles = value.read === "all" ? null : value.read.roles;
  const editRoles = value.edit === "all" ? null : value.edit.roles;
  const hiddenFrom = readRoles ? roles.filter((r) => !readRoles.includes(r)) : [];
  const viewOnly = computed || !editRoles ? [] : roles.filter((r) => !hiddenFrom.includes(r) && !editRoles.includes(r));

  return (
    <Stack gap="sm">
      <RuleRow title="Can view" rule={value.read} roles={roles} everyoneLabel="Everyone" pickerLabel="Roles that can view" onChange={setView} />
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
          onChange={setEdit}
        />
      )}
      <Text size="xs" c="dimmed" data-testid="access-summary">
        {accessSummary(value, computed)}
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
