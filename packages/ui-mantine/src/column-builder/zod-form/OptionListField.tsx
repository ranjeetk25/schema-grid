import {
  ActionIcon,
  Button,
  ColorSwatch,
  Group,
  Input,
  MultiSelect,
  Popover,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  UnstyledButton,
} from "@mantine/core";
import { IconChevronDown, IconChevronUp, IconLock, IconPlus, IconX } from "../../internal/icons";
import { type ReactNode, useEffect, useRef, useState } from "react";
import type { RoleRule } from "../../internal/core-contracts";
import { MANTINE_NAMED_COLORS } from "../../internal/options";
import { roleLabel } from "../PermissionsStep";

export interface OptionListItem {
  label: string;
  value: string;
  color?: string;
  /** Who may SET this option (core `Option.settableBy`, v0.3). Absent = everyone. */
  settableBy?: RoleRule;
}

export interface OptionListFieldProps {
  label: ReactNode;
  description?: ReactNode;
  value: unknown;
  /** Emits options keyed by `valueKey` (e.g. core `{id, label, color?, settableBy?}`). */
  onChange: (next: Record<string, unknown>[]) => void;
  /** Whether the schema's option object has a `color` field. */
  hasColor: boolean;
  /** Key of the stored value: `"id"` for core options (default `"value"`). */
  valueKey?: "id" | "value";
  /**
   * Roles offered by the per-option "Who can set" control (core options only,
   * i.e. `valueKey: "id"`). Absent → the control is not shown.
   */
  roles?: string[];
  error?: string;
  /** Dot-path of the list (e.g. `options`); rows' inputs carry `data-sg-path` for blur tracking. */
  path?: string;
  /** Per-row errors, e.g. `rowErrors(0, "label")`. */
  rowError?: (index: number, field: "label" | "value" | "color") => string | undefined;
}

interface Row {
  id: number;
  label: string;
  value: string;
  color?: string;
  settableBy?: RoleRule;
  /** Once true, editing the label no longer re-derives the value. */
  valueEdited: boolean;
}

const isRoleRule = (v: unknown): v is RoleRule =>
  v === "all" || (!!v && typeof v === "object" && Array.isArray((v as { roles?: unknown }).roles));

/** "In Progress!" → "in_progress": lowercase, non-alphanumerics → "_", trimmed underscores. */
export function slugifyOptionValue(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

const readOptions = (value: unknown, valueKey: "id" | "value"): OptionListItem[] =>
  Array.isArray(value)
    ? value
        .filter((o): o is Record<string, unknown> => !!o && typeof o === "object")
        .map((o) => ({
          label: typeof o.label === "string" ? o.label : "",
          value: typeof o[valueKey] === "string" ? (o[valueKey] as string) : "",
          ...(typeof o.color === "string" && o.color ? { color: o.color } : {}),
          ...(isRoleRule(o.settableBy) ? { settableBy: o.settableBy } : {}),
        }))
    : [];

const list = (roles: string[]) => {
  const labels = roles.map(roleLabel);
  return labels.length <= 1 ? labels.join("") : `${labels.slice(0, -1).join(", ")} and ${labels.at(-1)}`;
};

/** "Everyone" / "Only Admin and Finance team" / "Nobody yet". */
export function settableBySummary(rule: RoleRule | undefined): string {
  if (rule === undefined || rule === "all") return "Everyone";
  return rule.roles.length === 0 ? "Nobody yet" : `Only ${list(rule.roles)}`;
}

/**
 * Per-option "Who can set" (v0.3): a subtle pill that opens a small popover
 * with the same "Everyone | Only roles…" control as the column's access
 * section. Absent `settableBy` = everyone (never written as `"all"` unless it
 * already was).
 */
function WhoCanSet({ label, rule, roles, onChange }: { label: string; rule: RoleRule | undefined; roles: string[]; onChange(rule: RoleRule | undefined): void }) {
  const [opened, setOpened] = useState(false);
  const restricted = rule !== undefined && rule !== "all";
  const summary = settableBySummary(rule);
  return (
    <Popover opened={opened} onChange={setOpened} withinPortal={false} position="bottom-end" shadow="md" radius="lg" width={320}>
      <Popover.Target>
        <Button
          size="compact-xs"
          variant="subtle"
          color="gray"
          aria-label={`Who can set ${label || "this option"}: ${summary}`}
          aria-expanded={opened}
          data-testid="option-settable-by"
          leftSection={restricted ? <IconLock size={12} stroke={1.75} /> : undefined}
          styles={{ root: { fontWeight: 400, color: restricted ? "var(--mantine-color-text)" : "var(--mantine-color-dimmed)" } }}
          onClick={() => setOpened((o) => !o)}
        >
          {summary}
        </Button>
      </Popover.Target>
      <Popover.Dropdown p={12}>
        <Stack gap={8}>
          <Group justify="space-between" wrap="nowrap" gap="sm">
            <Text size="sm" style={{ whiteSpace: "nowrap" }}>
              Who can set
            </Text>
            <SegmentedControl
              aria-label={`Who can set ${label || "this option"}`}
              size="xs"
              value={restricted ? "roles" : "all"}
              onChange={(v) => onChange(v === "all" ? (rule === "all" ? "all" : undefined) : { roles: restricted ? rule.roles : [] })}
              data={[
                { value: "all", label: "Everyone" },
                { value: "roles", label: "Only roles…" },
              ]}
            />
          </Group>
          {restricted ? (
            <MultiSelect
              aria-label={`Roles that can set ${label || "this option"}`}
              placeholder="Pick roles"
              size="xs"
              data={roles.map((r) => ({ value: r, label: roleLabel(r) }))}
              value={rule.roles}
              onChange={(next) => onChange({ roles: next })}
              error={rule.roles.length === 0 ? "Pick at least one role" : undefined}
              searchable
              comboboxProps={{ withinPortal: false }}
            />
          ) : (
            <Text size="xs" c="dimmed">
              Anyone who can edit the column can pick this option.
            </Text>
          )}
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
}

const swatchColor = (color: string | undefined) => (color ? `var(--mantine-color-${color}-filled, ${color})` : "transparent");

function ColourPicker({ color, onPick, error }: { color?: string; onPick: (color: string) => void; error?: string }) {
  const [opened, setOpened] = useState(false);
  return (
    <Popover opened={opened} onChange={setOpened} withinPortal={false} position="bottom-start" shadow="md" radius="lg">
      <Popover.Target>
        <UnstyledButton
          aria-label="Option colour"
          title={error ?? color ?? "No colour"}
          onClick={() => setOpened((o) => !o)}
          style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 20, height: 20, borderRadius: 4 }}
        >
          <span
            aria-hidden
            style={{
              width: 10,
              height: 10,
              borderRadius: "50%",
              background: color ? swatchColor(color) : "transparent",
              border: color ? "none" : "1.5px dashed var(--mantine-color-dimmed)",
              outline: error ? "1px solid var(--mantine-color-error)" : undefined,
              outlineOffset: 2,
            }}
          />
        </UnstyledButton>
      </Popover.Target>
      <Popover.Dropdown p={8}>
        <SimpleGrid cols={7} spacing={6}>
          {MANTINE_NAMED_COLORS.map((name) => (
            <ColorSwatch
              key={name}
              component="button"
              type="button"
              aria-label={name}
              aria-pressed={color === name}
              title={name}
              color={`var(--mantine-color-${name}-filled)`}
              size={20}
              style={{ cursor: "pointer", outline: color === name ? "2px solid var(--mantine-primary-color-filled)" : undefined, outlineOffset: 2 }}
              onClick={() => {
                onPick(name);
                setOpened(false);
              }}
            />
          ))}
        </SimpleGrid>
      </Popover.Dropdown>
    </Popover>
  );
}

function projectRows(rows: Row[], hasColor: boolean | undefined, valueKey: "id" | "value"): Record<string, unknown>[] {
  return rows.map((r) =>
    valueKey === "id"
      ? {
          id: r.value,
          label: r.label,
          ...(hasColor && r.color ? { color: r.color } : {}),
          ...(r.settableBy !== undefined ? { settableBy: r.settableBy } : {}),
        }
      : { label: r.label, value: r.value, ...(hasColor && r.color ? { color: r.color } : {}) },
  );
}

/** Editable `{label, value, color?}[]` list: add, remove, reorder, auto-derived values, colour swatches. */
export function OptionListField({
  label,
  description,
  value,
  onChange,
  hasColor,
  valueKey = "value",
  error,
  path,
  rowError,
  roles,
}: OptionListFieldProps) {
  const showSettableBy = valueKey === "id" && roles !== undefined;
  const nextId = useRef(0);
  const toRows = (options: OptionListItem[]): Row[] =>
    options.map((o) => ({ id: nextId.current++, ...o, valueEdited: o.value !== slugifyOptionValue(o.label) }));

  const [rows, setRows] = useState<Row[]>(() => toRows(readOptions(value, valueKey)));
  const lastEmitted = useRef<unknown>(value);

  // Resync when the value is replaced from outside (not by our own emit).
  // biome-ignore lint/correctness/useExhaustiveDependencies: toRows only touches a ref
  useEffect(() => {
    if (value === lastEmitted.current) return;
    lastEmitted.current = value;
    // Content-equal echoes (a parent that clones/normalises) must not rebuild rows: that remounts inputs.
    if (JSON.stringify(readOptions(value, valueKey)) === JSON.stringify(readOptions(projectRows(rows, hasColor, valueKey), valueKey))) return;
    setRows(toRows(readOptions(value, valueKey)));
  }, [value]);

  const commit = (next: Row[]) => {
    setRows(next);
    const options = projectRows(next, hasColor, valueKey);
    lastEmitted.current = options;
    onChange(options);
  };

  const update = (index: number, patch: Partial<Row>) => commit(rows.map((r, i) => (i === index ? { ...r, ...patch } : r)));

  const move = (index: number, delta: -1 | 1) => {
    const target = index + delta;
    const a = rows[index];
    const b = rows[target];
    if (!a || !b) return;
    const next = [...rows];
    next[index] = b;
    next[target] = a;
    commit(next);
  };

  /**
   * The row's message goes under the NAME input: while the stored id is
   * derived from the name, an empty/invalid id is really a missing name.
   */
  const labelErrorFor = (row: Row, index: number): string | undefined => {
    const own = rowError?.(index, "label");
    if (own) return own;
    const valueError = row.valueEdited ? undefined : rowError?.(index, "value");
    if (!valueError) return undefined;
    return row.label.trim() === "" ? "Option name is required" : valueError;
  };

  return (
    <Input.Wrapper label={label} description={description} error={error}>
      <Stack gap="xs" mt={4}>
        {rows.map((row, index) => (
          <Group key={row.id} gap={4} wrap="nowrap" align="flex-start">
            <TextInput
              aria-label="Option label"
              data-sg-path={path ? `${path}.${index}.label` : undefined}
              placeholder="Option name"
              value={row.label}
              error={labelErrorFor(row, index)}
              style={{ flex: 1, minWidth: 0 }}
              leftSection={
                hasColor ? <ColourPicker color={row.color} error={rowError?.(index, "color")} onPick={(color) => update(index, { color })} /> : undefined
              }
              leftSectionPointerEvents="all"
              onChange={(e) => {
                const text = e.currentTarget.value;
                update(index, row.valueEdited ? { label: text } : { label: text, value: slugifyOptionValue(text) });
              }}
            />
            <TextInput
              aria-label={valueKey === "id" ? "Option id" : "Option value"}
              data-sg-path={path ? `${path}.${index}.${valueKey}` : undefined}
              placeholder={valueKey}
              value={row.value}
              error={row.valueEdited ? rowError?.(index, "value") : undefined}
              w={104}
              styles={{ input: { fontFamily: "var(--mantine-font-family-monospace)", fontSize: 12, color: "var(--mantine-color-dimmed)" } }}
              onChange={(e) => update(index, { value: e.currentTarget.value, valueEdited: true })}
            />
            {showSettableBy ? (
              <Group h={32} align="center" style={{ flex: "none" }}>
                <WhoCanSet label={row.label} rule={row.settableBy} roles={roles ?? []} onChange={(settableBy) => update(index, { settableBy })} />
              </Group>
            ) : null}
            <Group gap={0} wrap="nowrap" h={32} align="center">
              <ActionIcon className="sg-cp-icon-btn" size="sm" variant="subtle" color="gray" aria-label="Move option up" disabled={index === 0} onClick={() => move(index, -1)}>
                <IconChevronUp size={14} stroke={1.75} />
              </ActionIcon>
              <ActionIcon
                className="sg-cp-icon-btn"
                size="sm"
                variant="subtle"
                color="gray"
                aria-label="Move option down"
                disabled={index === rows.length - 1}
                onClick={() => move(index, 1)}
              >
                <IconChevronDown size={14} stroke={1.75} />
              </ActionIcon>
              <ActionIcon size="sm" variant="subtle" color="gray" aria-label="Remove option" onClick={() => commit(rows.filter((_, i) => i !== index))}>
                <IconX size={14} stroke={1.75} />
              </ActionIcon>
            </Group>
          </Group>
        ))}
        <Button
          variant="subtle"
          color="gray"
          size="xs"
          leftSection={<IconPlus size={14} stroke={1.75} />}
          style={{ alignSelf: "flex-start" }}
          onClick={() => commit([...rows, { id: nextId.current++, label: "", value: "", valueEdited: false }])}
        >
          Add option
        </Button>
      </Stack>
    </Input.Wrapper>
  );
}
