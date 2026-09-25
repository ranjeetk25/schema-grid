import { ActionIcon, Button, ColorSwatch, Group, Input, Popover, SimpleGrid, Stack, TextInput } from "@mantine/core";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { MANTINE_NAMED_COLORS } from "../../internal/options";

export interface OptionListItem {
  label: string;
  value: string;
  color?: string;
}

export interface OptionListFieldProps {
  label: ReactNode;
  description?: ReactNode;
  value: unknown;
  onChange: (next: OptionListItem[]) => void;
  /** Whether the schema's option object has a `color` field. */
  hasColor: boolean;
  error?: string;
  /** Per-row errors, e.g. `rowErrors(0, "label")`. */
  rowError?: (index: number, field: "label" | "value" | "color") => string | undefined;
}

interface Row {
  id: number;
  label: string;
  value: string;
  color?: string;
  /** Once true, editing the label no longer re-derives the value. */
  valueEdited: boolean;
}

/** "In Progress!" → "in_progress": lowercase, non-alphanumerics → "_", trimmed underscores. */
export function slugifyOptionValue(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

const readOptions = (value: unknown): OptionListItem[] =>
  Array.isArray(value)
    ? value
        .filter((o): o is Record<string, unknown> => !!o && typeof o === "object")
        .map((o) => ({
          label: typeof o.label === "string" ? o.label : "",
          value: typeof o.value === "string" ? o.value : "",
          ...(typeof o.color === "string" && o.color ? { color: o.color } : {}),
        }))
    : [];

const swatchColor = (color: string | undefined) => (color ? `var(--mantine-color-${color}-filled, ${color})` : "transparent");

function ColourPicker({ color, onPick, error }: { color?: string; onPick: (color: string) => void; error?: string }) {
  const [opened, setOpened] = useState(false);
  return (
    <Popover opened={opened} onChange={setOpened} withinPortal={false} position="bottom-end" shadow="md">
      <Popover.Target>
        <ColorSwatch
          component="button"
          type="button"
          aria-label="Option colour"
          title={error ?? color ?? "No colour"}
          color={swatchColor(color)}
          size={24}
          withShadow
          style={{ cursor: "pointer", flexShrink: 0, outline: error ? "1px solid var(--mantine-color-error)" : undefined }}
          onClick={() => setOpened((o) => !o)}
        />
      </Popover.Target>
      <Popover.Dropdown>
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
              size={22}
              style={{ cursor: "pointer" }}
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

function projectRows(rows: Row[], hasColor: boolean | undefined): OptionListItem[] {
  return rows.map((r) => ({
    label: r.label,
    value: r.value,
    ...(hasColor && r.color ? { color: r.color } : {}),
  }));
}

/** Editable `{label, value, color?}[]` list: add, remove, reorder, auto-derived values, colour swatches. */
export function OptionListField({ label, description, value, onChange, hasColor, error, rowError }: OptionListFieldProps) {
  const nextId = useRef(0);
  const toRows = (options: OptionListItem[]): Row[] =>
    options.map((o) => ({ id: nextId.current++, ...o, valueEdited: o.value !== slugifyOptionValue(o.label) }));

  const [rows, setRows] = useState<Row[]>(() => toRows(readOptions(value)));
  const lastEmitted = useRef<unknown>(value);

  // Resync when the value is replaced from outside (not by our own emit).
  // biome-ignore lint/correctness/useExhaustiveDependencies: toRows only touches a ref
  useEffect(() => {
    if (value === lastEmitted.current) return;
    lastEmitted.current = value;
    // Content-equal echoes (a parent that clones/normalises) must not rebuild rows: that remounts inputs.
    if (JSON.stringify(readOptions(value)) === JSON.stringify(readOptions(projectRows(rows, hasColor)))) return;
    setRows(toRows(readOptions(value)));
  }, [value]);

  const commit = (next: Row[]) => {
    setRows(next);
    const options = projectRows(next, hasColor);
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

  return (
    <Input.Wrapper label={label} description={description} error={error}>
      <Stack gap="xs" mt={4}>
        {rows.map((row, index) => (
          <Group key={row.id} gap={6} wrap="nowrap" align="flex-start">
            <TextInput
              aria-label="Option label"
              placeholder="Label"
              value={row.label}
              error={rowError?.(index, "label")}
              style={{ flex: 1 }}
              onChange={(e) => {
                const text = e.currentTarget.value;
                update(index, row.valueEdited ? { label: text } : { label: text, value: slugifyOptionValue(text) });
              }}
            />
            <TextInput
              aria-label="Option value"
              placeholder="value"
              value={row.value}
              error={rowError?.(index, "value")}
              style={{ flex: 1 }}
              onChange={(e) => update(index, { value: e.currentTarget.value, valueEdited: true })}
            />
            {hasColor && (
              <ColourPicker color={row.color} error={rowError?.(index, "color")} onPick={(color) => update(index, { color })} />
            )}
            <ActionIcon variant="subtle" color="gray" aria-label="Move option up" disabled={index === 0} onClick={() => move(index, -1)}>
              ↑
            </ActionIcon>
            <ActionIcon
              variant="subtle"
              color="gray"
              aria-label="Move option down"
              disabled={index === rows.length - 1}
              onClick={() => move(index, 1)}
            >
              ↓
            </ActionIcon>
            <ActionIcon variant="subtle" color="red" aria-label="Remove option" onClick={() => commit(rows.filter((_, i) => i !== index))}>
              ×
            </ActionIcon>
          </Group>
        ))}
        <Button
          variant="light"
          size="xs"
          style={{ alignSelf: "flex-start" }}
          onClick={() => commit([...rows, { id: nextId.current++, label: "", value: "", valueEdited: false }])}
        >
          Add option
        </Button>
      </Stack>
    </Input.Wrapper>
  );
}
