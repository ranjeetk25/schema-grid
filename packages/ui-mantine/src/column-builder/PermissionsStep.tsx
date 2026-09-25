import { Alert, MultiSelect, SegmentedControl, Stack, Text } from "@mantine/core";
import type { ColumnPermissions, RoleRule } from "../internal/core-contracts";

export interface PermissionsStepProps {
  value: ColumnPermissions;
  onChange(value: ColumnPermissions): void;
  roles: string[];
}

const EMPTY_ROLES = "Choose at least one role";

/** First blocking error (an empty role list), or null. */
export function permissionsError(p: ColumnPermissions): string | null {
  for (const rule of [p.read, p.edit]) {
    if (rule !== "all" && rule.roles.length === 0) return EMPTY_ROLES;
  }
  return null;
}

/** True when some role could edit without being able to read. */
export function editNotSubsetOfRead(p: ColumnPermissions): boolean {
  if (p.read === "all") return false;
  if (p.edit === "all") return true;
  const readRoles = p.read.roles;
  return p.edit.roles.some((r) => !readRoles.includes(r));
}

function RuleField({
  label,
  rule,
  roles,
  onChange,
}: {
  label: "Read" | "Edit";
  rule: RoleRule;
  roles: string[];
  onChange(rule: RoleRule): void;
}) {
  const mode = rule === "all" ? "all" : "roles";
  return (
    <Stack gap={6}>
      <Text size="sm" fw={500}>
        {`${label} access`}
      </Text>
      <SegmentedControl
        aria-label={`${label} access`}
        value={mode}
        onChange={(v) => onChange(v === "all" ? "all" : { roles: rule === "all" ? [] : rule.roles })}
        data={[
          { value: "all", label: "All" },
          { value: "roles", label: "Roles" },
        ]}
      />
      {rule !== "all" && (
        <MultiSelect
          aria-label={`${label} roles`}
          placeholder="Pick roles"
          data={roles}
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

export function PermissionsStep({ value, onChange, roles }: PermissionsStepProps) {
  return (
    <Stack gap="md">
      <RuleField label="Read" rule={value.read} roles={roles} onChange={(read) => onChange({ ...value, read })} />
      <RuleField label="Edit" rule={value.edit} roles={roles} onChange={(edit) => onChange({ ...value, edit })} />
      {editNotSubsetOfRead(value) && (
        <Alert color="yellow" variant="light">
          Some roles can edit but not read this column. They will not see it, so they cannot edit it either.
        </Alert>
      )}
    </Stack>
  );
}
