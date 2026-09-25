import { Card, Group, Stack, Text } from "@mantine/core";
import { useEffect, useState } from "react";
import type { FieldTypeId, FieldTypeRegistry } from "../internal/core-contracts";
import { type UiFieldTypeRegistry, resolveEditorComponent } from "../internal/grid-contracts";
import { getSelectOptions } from "../internal/options";
import { draftAsColumn } from "./CommonFields";
import type { ColumnDraft } from "./model";

export interface PreviewStepProps {
  draft: ColumnDraft;
  registry: FieldTypeRegistry;
  uiRegistry: UiFieldTypeRegistry;
}

const isBlank = (v: unknown) => v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);

/** The type's default value when it is meaningful, else a representative sample. */
export function sampleValueFor(type: FieldTypeId, config: unknown, registry: FieldTypeRegistry): unknown {
  const options = getSelectOptions(config).map((o) => o.value);
  switch (type) {
    case "select":
    case "creatableSelect":
      return options[0] ?? null;
    case "multiSelect":
      return options.slice(0, 2);
    case "boolean":
      return true;
    case "number":
      return 42;
    case "currency":
      return 123456;
    case "text":
      return "Sample text";
    case "longText":
      return "A longer sample\nspanning two lines";
    case "date":
      return "2026-01-15";
    case "datetime":
      return "2026-01-15T09:30:00.000Z";
    case "url":
      return "https://example.com";
    case "email":
      return "name@example.com";
    case "phone":
      return "+91 98765 43210";
    case "user":
      return { id: "u_sample", name: "Asha Rao" };
    case "link":
      return { id: "r_sample", label: "Record 1" };
    default: {
      const fieldType = registry.get(type);
      const d = fieldType?.defaultValue(fieldType.configSchema.safeParse(config).data ?? fieldType.defaultConfig);
      return isBlank(d) ? null : d;
    }
  }
}

/** Live preview: the type's inline editor bound to local state, and its renderer showing the value. */
export function PreviewStep({ draft, registry, uiRegistry }: PreviewStepProps) {
  const type = draft.type ?? "text";
  const [value, setValue] = useState<unknown>(() => sampleValueFor(type, draft.config, registry));
  useEffect(() => {
    setValue(sampleValueFor(type, draft.config, registry));
  }, [type, draft.config, registry]);

  const column = draftAsColumn(draft);
  const entry = uiRegistry.get(type);
  const Editor = resolveEditorComponent(entry?.editor);
  const Renderer = entry?.renderer;
  const fieldType = registry.get(type);

  return (
    <Stack gap="md">
      <Card withBorder padding="sm">
        <Text size="xs" c="dimmed" mb={4}>
          Cell preview
        </Text>
        <Group gap="xs" mih={28} data-testid="preview-cell">
          {Renderer ? (
            <Renderer value={value} column={column} config={draft.config} fieldType={type} />
          ) : (
            <Text size="sm">{fieldType ? fieldType.format(value, draft.config) : String(value ?? "")}</Text>
          )}
        </Group>
      </Card>
      {type === "formula" ? (
        <Text size="sm" c="dimmed">
          Formula columns are computed from other columns and cannot be edited.
        </Text>
      ) : Editor ? (
        <Stack gap={4}>
          <Text size="sm" fw={500}>
            Try the editor
          </Text>
          <Editor
            value={value}
            onChange={setValue}
            onCommit={(v) => {
              if (v !== undefined) setValue(v);
            }}
            onCancel={() => {}}
            column={column}
            config={draft.config}
            autoFocus={false}
          />
        </Stack>
      ) : null}
    </Stack>
  );
}
