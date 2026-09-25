import { Anchor, Group, Progress, Stack, Text } from "@mantine/core";
import type { ImportJobStatus } from "../../internal/io-contracts";

const STATE_TEXT: Record<ImportJobStatus["state"], string> = {
  queued: "Queued",
  running: "Running",
  done: "Done",
  failed: "Failed",
};

const STATE_COLOR: Record<ImportJobStatus["state"], string> = {
  queued: "gray",
  running: "blue",
  done: "green",
  failed: "red",
};

export function jobPercent(job: ImportJobStatus): number {
  if (job.total <= 0) return job.state === "done" ? 100 : 0;
  return Math.min(100, Math.max(0, Math.round((job.processed / job.total) * 100)));
}

export interface RunStepProps {
  job?: ImportJobStatus;
}

export function RunStep({ job }: RunStepProps) {
  if (!job) {
    return (
      <Text size="sm" c="dimmed">
        Waiting for import to start…
      </Text>
    );
  }
  const percent = jobPercent(job);
  return (
    <Stack gap="sm">
      <Progress.Root size="lg">
        <Progress.Section value={percent} color={STATE_COLOR[job.state]} aria-label="Import progress" />
      </Progress.Root>
      <Group justify="space-between">
        <Text size="sm" fw={500}>
          {STATE_TEXT[job.state]} · {job.processed} of {job.total} rows
        </Text>
        <Text size="sm" c={job.errorCount > 0 ? "red" : "dimmed"}>
          {job.errorCount} {job.errorCount === 1 ? "error" : "errors"}
        </Text>
      </Group>
      {job.errorReportUrl ? (
        <Anchor href={job.errorReportUrl} download size="sm">
          Download error report
        </Anchor>
      ) : null}
    </Stack>
  );
}
