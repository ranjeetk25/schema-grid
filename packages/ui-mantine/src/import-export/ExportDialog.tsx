import { Alert, Button, Group, Modal, Radio, SegmentedControl, Stack, Text } from "@mantine/core";
import { IconDownload } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import type { ExportFormat } from "../internal/io-contracts";

export type ExportScope = "view" | "selected" | "all";

export interface ExportRequest {
  scope: ExportScope;
  format: ExportFormat;
}

export interface ExportDialogProps {
  opened: boolean;
  onClose(): void;
  visibleColumnCount: number;
  selectedRowCount: number;
  defaultScope?: ExportScope;
  defaultFormat?: ExportFormat;
  onExport(request: ExportRequest): Promise<void> | void;
}

export function ExportDialog({
  opened,
  onClose,
  visibleColumnCount,
  selectedRowCount,
  defaultScope = "view",
  defaultFormat = "csv",
  onExport,
}: ExportDialogProps) {
  const initialScope = defaultScope === "selected" && selectedRowCount === 0 ? "view" : defaultScope;
  const [scope, setScope] = useState<ExportScope>(initialScope);
  const [format, setFormat] = useState<ExportFormat>(defaultFormat);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (opened) {
      setScope(initialScope);
      setError(null);
    }
  }, [opened, initialScope]);

  useEffect(() => {
    if (scope === "selected" && selectedRowCount === 0) setScope("view");
  }, [scope, selectedRowCount]);

  const submit = async () => {
    setPending(true);
    setError(null);
    try {
      await onExport({ scope, format });
      setPending(false);
      onClose();
    } catch (e) {
      setPending(false);
      setError(e instanceof Error ? e.message : "Export failed");
    }
  };

  return (
    <Modal opened={opened} onClose={pending ? () => {} : onClose} title="Export" size={440}>
      <Stack gap="lg">
        <Radio.Group label="Rows" value={scope} onChange={(v) => setScope(v as ExportScope)}>
          <Stack gap={10} mt={8}>
            <Radio value="view" label="Current view" />
            <Radio
              value="selected"
              label={`Selected rows (${selectedRowCount})`}
              disabled={selectedRowCount === 0}
            />
            <Radio value="all" label="All rows" />
          </Stack>
        </Radio.Group>
        <Stack gap={4}>
          <Text size="sm" fw={500}>
            Format
          </Text>
          <SegmentedControl
            value={format}
            onChange={(v) => setFormat(v as ExportFormat)}
            style={{ alignSelf: "flex-start" }}
            data={[
              { value: "csv", label: "CSV" },
              { value: "xlsx", label: "XLSX" },
            ]}
          />
        </Stack>
        <Text size="xs" c="dimmed">
          {`Includes ${visibleColumnCount} visible column${visibleColumnCount === 1 ? "" : "s"}`}
        </Text>
        {error && (
          <Alert color="red" role="alert">
            {error}
          </Alert>
        )}
        <Group justify="flex-end" gap="xs">
          <Button variant="subtle" color="gray" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={submit} loading={pending} leftSection={<IconDownload size={16} stroke={1.75} />}>
            Export
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
