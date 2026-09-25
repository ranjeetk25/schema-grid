import { Alert, Button, FileButton, Group, Stack, Text } from "@mantine/core";
import { useRef } from "react";
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

export function UploadStep({ file, fileName, parsing, parseError, rowCount, truncated = false, onFile }: UploadStepProps) {
  const resetRef = useRef<() => void>(null);
  return (
    <Stack gap="sm">
      <Text size="sm" c="dimmed">
        Upload a CSV or Excel (.xlsx) file. The first row must contain column headers.
      </Text>
      <Group>
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
            <Button variant="default" loading={parsing} {...props}>
              {file || fileName ? "Choose another file" : "Choose file"}
            </Button>
          )}
        </FileButton>
        {fileName ? (
          <Group gap="xs">
            <Text size="sm" fw={500}>
              {fileName}
            </Text>
            {file ? (
              <Text size="sm" c="dimmed">
                {formatFileSize(file.size)}
              </Text>
            ) : null}
          </Group>
        ) : null}
      </Group>
      {rowCount != null && !parseError ? (
        <Text size="sm" c="dimmed">
          {rowCount} {rowCount === 1 ? "row" : "rows"} found
          {truncated ? " (the file has more rows than can be imported at once; the rest were dropped)" : ""}
        </Text>
      ) : null}
      {parseError ? (
        <Alert color="red" title="Could not parse file">
          {parseError}
        </Alert>
      ) : null}
    </Stack>
  );
}
