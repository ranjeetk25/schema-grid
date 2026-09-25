import { Alert, Group, Loader, SegmentedControl, Stack, Table, Text, Tooltip } from "@mantine/core";
import type { ColumnDef } from "../../internal/core-contracts";
import type { ColumnMapping, ParsedTable, UnknownOptionsPolicy, ValidationReport } from "../../internal/io-contracts";
import { summarizePreview } from "../import-model";

const POLICY_DATA: { label: string; value: UnknownOptionsPolicy }[] = [
  { label: "Create options", value: "create" },
  { label: "Reject rows", value: "reject" },
];

export interface PreviewStepProps {
  parsed: ParsedTable;
  mapping: ColumnMapping[];
  /** Columns the mapping may point at (labels for the table header). */
  columns: ColumnDef[];
  preview: ValidationReport | null;
  loading: boolean;
  error: string | null;
  unknownOptions: UnknownOptionsPolicy;
  onPolicyChange(policy: UnknownOptionsPolicy): void;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function isPolicy(value: string): value is UnknownOptionsPolicy {
  return value === "create" || value === "reject";
}

export function PreviewStep({
  parsed,
  mapping,
  columns,
  preview,
  loading,
  error,
  unknownOptions,
  onPolicyChange,
}: PreviewStepProps) {
  if (loading && !preview) {
    return (
      <Group justify="center" py="lg">
        <Loader size="sm" />
        <Text size="sm">Validating rows…</Text>
      </Group>
    );
  }
  if (error) {
    return (
      <Alert color="red" title="Preview failed">
        {error}
      </Alert>
    );
  }
  if (!preview) return null;

  const byId = new Map(columns.map((c) => [c.id, c]));
  const mapped = mapping.filter((m): m is ColumnMapping & { columnId: string } => m.columnId != null);
  const summary = summarizePreview(preview);
  const showPolicy = summary.unknownOptions > 0 || unknownOptions === "reject";
  const unmappedRequired = preview.summary.unmappedRequired.map((id) => byId.get(id)?.label ?? id);

  return (
    <Stack gap="sm">
      <Group gap="lg">
        <Text size="sm" c="green">
          {plural(summary.valid, "valid row")}
        </Text>
        <Text size="sm" c={summary.invalid > 0 ? "red" : "dimmed"}>
          {plural(summary.invalid, "invalid row")}
        </Text>
        <Text size="sm" c={summary.unknownOptions > 0 ? "orange" : "dimmed"}>
          {plural(summary.unknownOptions, "unknown value")}
        </Text>
      </Group>
      {parsed.rows.length > preview.rows.length ? (
        <Text size="xs" c="dimmed">
          Previewing the first {preview.rows.length} of {parsed.rows.length} rows.
        </Text>
      ) : null}
      {unmappedRequired.length > 0 ? (
        <Text size="sm" c="orange">
          Required columns not in the file: {unmappedRequired.join(", ")}
        </Text>
      ) : null}
      {showPolicy ? (
        <Stack gap={4}>
          <Text size="sm" fw={500}>
            Values that are not existing options
          </Text>
          <SegmentedControl
            aria-label="Unknown option values"
            disabled={loading}
            data={POLICY_DATA}
            value={unknownOptions}
            onChange={(v) => {
              if (isPolicy(v)) onPolicyChange(v);
            }}
          />
        </Stack>
      ) : null}
      <Table.ScrollContainer minWidth={400} maxHeight={360}>
        <Table verticalSpacing={6} horizontalSpacing="sm" styles={{ th: { fontSize: 12, fontWeight: 500, color: "var(--mantine-color-dimmed)" }, td: { fontSize: 13 } }}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th w={56}>Row</Table.Th>
              {mapped.map((m) => (
                <Table.Th key={m.headerIndex}>{byId.get(m.columnId)?.label ?? m.header}</Table.Th>
              ))}
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {preview.rows.map((row) => (
              <Table.Tr key={row.index}>
                {row.rowError ? (
                  <Table.Td data-row-error="true" style={{ background: "var(--mantine-color-red-light)" }}>
                    <Text size="sm">{row.sourceRow}</Text>
                    <Text size="xs" c="red">
                      {row.rowError}
                    </Text>
                  </Table.Td>
                ) : (
                  <Table.Td>{row.sourceRow}</Table.Td>
                )}
                {mapped.map((m) => {
                  const cell = row.cells[m.columnId];
                  const raw = cell?.raw ?? parsed.rows[row.index]?.[m.headerIndex] ?? "";
                  if (cell?.error) {
                    return (
                      <Table.Td
                        key={m.headerIndex}
                        data-row={row.index}
                        data-column={m.columnId}
                        data-error="true"
                        style={{ background: "var(--mantine-color-red-light)" }}
                      >
                        <Tooltip label={cell.error} multiline events={{ hover: true, focus: true, touch: true }}>
                          <Text span size="sm" aria-invalid="true" tabIndex={0} display="block">
                            {raw === "" ? " " : raw}
                          </Text>
                        </Tooltip>
                      </Table.Td>
                    );
                  }
                  if (cell?.skip) {
                    return (
                      <Table.Td key={m.headerIndex} data-row={row.index} data-column={m.columnId} data-skip="true">
                        <Text span size="sm" c="dimmed" fs="italic">
                          unchanged
                        </Text>
                      </Table.Td>
                    );
                  }
                  return (
                    <Table.Td key={m.headerIndex} data-row={row.index} data-column={m.columnId}>
                      {raw}
                    </Table.Td>
                  );
                })}
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
    </Stack>
  );
}
