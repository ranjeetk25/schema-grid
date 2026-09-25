import { Alert, Group, Loader, SegmentedControl, Stack, Table, Text, Tooltip } from "@mantine/core";
import type { ColumnDef } from "../../internal/core-contracts";
import type { CellValidationError, ColumnMapping, ParsedFile, RowValidationResult, UnknownEnumPolicy } from "../../internal/io-contracts";
import { summarizePreview } from "../import-model";

const POLICY_DATA: { label: string; value: UnknownEnumPolicy }[] = [
  { label: "Create options", value: "createOptions" },
  { label: "Reject rows", value: "rejectRows" },
];

export interface PreviewStepProps {
  parsed: ParsedFile;
  mapping: ColumnMapping;
  columns: ColumnDef[];
  preview: RowValidationResult[] | null;
  loading: boolean;
  error: string | null;
  unknownEnumPolicy: UnknownEnumPolicy;
  onPolicyChange(policy: UnknownEnumPolicy): void;
  totalRows: number;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function isPolicy(value: string): value is UnknownEnumPolicy {
  return value === "createOptions" || value === "rejectRows";
}

export function PreviewStep({
  parsed,
  mapping,
  columns,
  preview,
  loading,
  error,
  unknownEnumPolicy,
  onPolicyChange,
  totalRows,
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

  const labelById = new Map(columns.map((c) => [c.id, c.label]));
  const mapped = parsed.headers
    .map((header, index) => ({ header, index, columnId: mapping[header] ?? null }))
    .filter((m): m is { header: string; index: number; columnId: string } => m.columnId != null);
  const summary = summarizePreview(preview);

  return (
    <Stack gap="sm">
      <Group gap="lg">
        <Text size="sm" c="green">
          {plural(summary.valid, "valid row")}
        </Text>
        <Text size="sm" c={summary.invalid > 0 ? "red" : "dimmed"}>
          {plural(summary.invalid, "invalid row")}
        </Text>
        <Text size="sm" c={summary.unknownEnum > 0 ? "orange" : "dimmed"}>
          {plural(summary.unknownEnum, "unknown value")}
        </Text>
      </Group>
      {totalRows > preview.length ? (
        <Text size="xs" c="dimmed">
          Previewing the first {preview.length} of {totalRows} rows.
        </Text>
      ) : null}
      {summary.unknownEnum > 0 ? (
        <Stack gap={4}>
          <Text size="sm" fw={500}>
            Values that are not existing options
          </Text>
          <SegmentedControl
            aria-label="Unknown option values"
            disabled={loading}
            data={POLICY_DATA}
            value={unknownEnumPolicy}
            onChange={(v) => {
              if (isPolicy(v)) onPolicyChange(v);
            }}
          />
        </Stack>
      ) : null}
      <Table.ScrollContainer minWidth={400} maxHeight={360}>
        <Table striped={false} withTableBorder>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Row</Table.Th>
              {mapped.map((m) => (
                <Table.Th key={m.index}>{labelById.get(m.columnId) ?? m.header}</Table.Th>
              ))}
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {preview.map((result) => {
              const row = parsed.rows[result.rowIndex] ?? [];
              const errorsByColumn = new Map<string, CellValidationError[]>();
              for (const e of result.errors) {
                const list = errorsByColumn.get(e.columnId) ?? [];
                list.push(e);
                errorsByColumn.set(e.columnId, list);
              }
              return (
                <Table.Tr key={result.rowIndex}>
                  {result.rowError ? (
                    <Table.Td data-row-error="true" style={{ background: "var(--mantine-color-red-light)" }}>
                      <Text size="sm">{result.rowIndex + 1}</Text>
                      <Text size="xs" c="red">
                        {result.rowError}
                      </Text>
                    </Table.Td>
                  ) : (
                    <Table.Td>{result.rowIndex + 1}</Table.Td>
                  )}
                  {mapped.map((m) => {
                    const raw = row[m.index] ?? "";
                    const cellErrors = errorsByColumn.get(m.columnId);
                    if (!cellErrors) {
                      return (
                        <Table.Td key={m.index} data-row={result.rowIndex} data-column={m.columnId}>
                          {raw}
                        </Table.Td>
                      );
                    }
                    const message = cellErrors.map((e) => e.message).join("; ");
                    return (
                      <Table.Td
                        key={m.index}
                        data-row={result.rowIndex}
                        data-column={m.columnId}
                        data-error="true"
                        style={{ background: "var(--mantine-color-red-light)" }}
                      >
                        <Tooltip label={message} multiline events={{ hover: true, focus: true, touch: true }}>
                          <Text span size="sm" aria-invalid="true" tabIndex={0} display="block">
                            {raw === "" ? "\u00a0" : raw}
                          </Text>
                        </Tooltip>
                      </Table.Td>
                    );
                  })}
                </Table.Tr>
              );
            })}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
    </Stack>
  );
}
