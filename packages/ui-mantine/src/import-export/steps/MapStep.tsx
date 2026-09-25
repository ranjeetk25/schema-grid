import { Select, SegmentedControl, Stack, Table, Text } from "@mantine/core";
import { IconArrowRight } from "@tabler/icons-react";
import type { ColumnDef } from "../../internal/core-contracts";
import type { ColumnMapping, ImportMode } from "../../internal/io-contracts";
import type { MappingErrors } from "../import-model";

const SKIP = "__skip__";

const MODE_DATA: { label: string; value: ImportMode }[] = [
  { label: "Create", value: "create" },
  { label: "Update", value: "update" },
  { label: "Upsert", value: "upsert" },
];

const MODE_HELP: Record<ImportMode, string> = {
  create: "Every row in the file becomes a new row.",
  update: "Rows are matched on a key column and updated; unmatched rows are skipped.",
  upsert: "Matched rows are updated; the rest are created.",
};

export interface MapStepProps {
  headers: string[];
  mapping: ColumnMapping[];
  targets: ColumnDef[];
  /** Id of a read-only key column offered only to match existing rows. */
  matchOnlyColumnId?: string | null;
  keyColumns: ColumnDef[];
  keyColumnId: string | null;
  mode: ImportMode;
  errors: MappingErrors;
  onMappingChange(headerIndex: number, columnId: string | null): void;
  onKeyColumnChange(columnId: string | null): void;
  onModeChange(mode: ImportMode): void;
}

function isMode(value: string): value is ImportMode {
  return value === "create" || value === "update" || value === "upsert";
}

export function MapStep({
  headers,
  mapping,
  targets,
  matchOnlyColumnId = null,
  keyColumns,
  keyColumnId,
  mode,
  errors,
  onMappingChange,
  onKeyColumnChange,
  onModeChange,
}: MapStepProps) {
  const targetData = [{ label: "Skip", value: SKIP }, ...targets.map((c) => ({
      label: c.id === matchOnlyColumnId ? `${c.label} (key, match only)` : c.label,
      value: c.id,
    })),
  ];
  const keyData = keyColumns.map((c) => ({ label: c.label, value: c.id }));

  return (
    <Stack gap="md">
      <Stack gap={4}>
        <Text size="sm" fw={500}>
          Import mode
        </Text>
        <SegmentedControl
          aria-label="Import mode"
          data={MODE_DATA}
          value={mode}
          style={{ alignSelf: "flex-start" }}
          onChange={(v) => {
            if (isMode(v)) onModeChange(v);
          }}
        />
        <Text size="xs" c="dimmed">
          {MODE_HELP[mode]}
        </Text>
      </Stack>
      {mode !== "create" ? (
        <Select
          label="Key column"
          description="Existing rows are matched on this column"
          placeholder="Choose a column"
          data={keyData}
          value={keyColumnId}
          onChange={(v) => onKeyColumnChange(v)}
          error={errors.keyColumn ?? undefined}
          clearable
          searchable
          comboboxProps={{ withinPortal: false }}
        />
      ) : null}
      <Table verticalSpacing={6} horizontalSpacing="sm" withRowBorders layout="fixed">
        <Table.Thead>
          <Table.Tr>
            <Table.Th style={{ fontSize: 12, fontWeight: 500, color: "var(--mantine-color-dimmed)" }}>File column</Table.Th>
            <Table.Th w={28} aria-hidden />
            <Table.Th style={{ fontSize: 12, fontWeight: 500, color: "var(--mantine-color-dimmed)" }}>Imports into</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {headers.map((header, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: headers may repeat; the position is the identity
            <Table.Tr key={index}>
              <Table.Td>
                <Text size="sm" c={header.trim() === "" ? "dimmed" : undefined} truncate>
                  {header.trim() === "" ? `(blank, column ${index + 1})` : header}
                </Text>
              </Table.Td>
              <Table.Td aria-hidden style={{ color: "var(--mantine-color-dimmed)", verticalAlign: "middle", lineHeight: 0 }}>
                <IconArrowRight size={14} stroke={1.75} style={{ display: "block" }} />
              </Table.Td>
              <Table.Td>
                <Select
                  aria-label={`Map ${header.trim() === "" ? `column ${index + 1}` : header}`}
                  data={targetData}
                  value={mapping.find((m) => m.headerIndex === index)?.columnId ?? SKIP}
                  onChange={(v) => onMappingChange(index, v == null || v === SKIP ? null : v)}
                  allowDeselect={false}
                  error={errors.byIndex[index]}
                  comboboxProps={{ withinPortal: false }}
                />
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      {errors.general ? (
        <Text size="sm" c="red">
          {errors.general}
        </Text>
      ) : null}
    </Stack>
  );
}
