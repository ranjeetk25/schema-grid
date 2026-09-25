import { Alert, Button, FileButton, Group, Stack, Text } from "@mantine/core";
import { IconFileSpreadsheet, IconUpload } from "@tabler/icons-react";
import { useRef, useState } from "react";
import { formatFileSize } from "../import-model";

export const IMPORT_ACCEPT =
  ".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export interface UploadStepProps {
  file: File | null;
  fileName: string;
  parsing: boolean;
  parseError: string | null;
  rowCount: number | null;
  /** The file had more rows than the parser keeps. */
  truncated?: boolean;
  onFile(file: File): void;
}

/** A drop zone (drag a file in, or choose one) plus the picked file's name, size and row count. */
export function UploadStep({ file, fileName, parsing, parseError, rowCount, truncated = false, onFile }: UploadStepProps) {
  const resetRef = useRef<() => void>(null);
  const [dragging, setDragging] = useState(false);
  return (
    <Stack gap="md">
      <Stack
        align="center"
        gap={8}
        py={28}
        px="md"
        data-testid="import-dropzone"
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const dropped = e.dataTransfer.files?.[0];
          if (dropped) onFile(dropped);
        }}
        style={{
          border: `1px dashed ${dragging ? "var(--mantine-primary-color-filled)" : "var(--mantine-color-default-border)"}`,
          borderRadius: "var(--mantine-radius-lg)",
          background: dragging ? "var(--mantine-primary-color-light)" : "var(--mantine-color-default-hover)",
          transition: "background 120ms ease-out, border-color 120ms ease-out",
        }}
      >
        <IconUpload size={20} stroke={1.75} style={{ color: "var(--mantine-color-dimmed)" }} aria-hidden />
        <Text size="sm" fw={500}>
          Drop a file here, or
        </Text>
        <FileButton
          accept={IMPORT_ACCEPT}
          resetRef={resetRef}
          onChange={(f) => {
            if (f) onFile(f);
            // Clear the input so picking the same file again still fires onChange.
            resetRef.current?.();
          }}
          inputProps={{ "aria-label": "Import file" }}
        >
          {(props) => (
            <Button variant="default" size="xs" loading={parsing} {...props}>
              {file || fileName ? "Choose another file" : "Choose file"}
            </Button>
          )}
        </FileButton>
        <Text size="xs" c="dimmed">
          CSV or Excel (.xlsx) · the first row must contain column headers
        </Text>
      </Stack>
      {fileName ? (
        <Group gap="xs" wrap="nowrap">
          <IconFileSpreadsheet size={16} stroke={1.75} style={{ color: "var(--mantine-color-dimmed)", flexShrink: 0 }} aria-hidden />
          <Text size="sm" fw={500} truncate>
            {fileName}
          </Text>
          {file ? (
            <Text size="sm" c="dimmed">
              {formatFileSize(file.size)}
            </Text>
          ) : null}
          {rowCount != null && !parseError ? (
            <>
              <Text size="sm" c="dimmed" aria-hidden>
                ·
              </Text>
              <Text size="sm" c="dimmed">{`${rowCount} ${rowCount === 1 ? "row" : "rows"} found`}</Text>
            </>
          ) : null}
        </Group>
      ) : null}
      {truncated && rowCount != null && !parseError ? (
        <Text size="xs" c="dimmed">
          The file has more rows than can be imported at once; the rest were dropped.
        </Text>
      ) : null}
      {parseError ? (
        <Alert color="red" variant="light" title="Could not parse file">
          {parseError}
        </Alert>
      ) : null}
    </Stack>
  );
}
