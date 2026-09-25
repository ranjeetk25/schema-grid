import { CircleCheckIcon, CircleXIcon, DownloadIcon } from "lucide-react";
import type { ImportJobStatus } from "../../internal/io-contracts";
import { cn } from "../../lib/cn";
import { buttonVariants } from "../../ui/button";
import { Spinner } from "../parts";

const STATE_TEXT: Record<ImportJobStatus["state"], string> = {
  queued: "Queued",
  running: "Running",
  done: "Done",
  failed: "Failed",
};

export function jobPercent(job: ImportJobStatus): number {
  if (job.total <= 0) return job.state === "done" ? 100 : 0;
  return Math.min(100, Math.max(0, Math.round((job.processed / job.total) * 100)));
}

export interface RunStepProps {
  job?: ImportJobStatus;
}

function StateIcon({ state }: { state: ImportJobStatus["state"] }) {
  if (state === "done") return <CircleCheckIcon aria-hidden className="sg:size-5 sg:text-success" />;
  if (state === "failed") return <CircleXIcon aria-hidden className="sg:size-5 sg:text-danger" />;
  return <Spinner className="sg:size-5" />;
}

export function RunStep({ job }: RunStepProps) {
  if (!job) {
    return (
      <output className="sg:flex sg:flex-col sg:items-center sg:justify-center sg:gap-3 sg:py-16 sg:text-center">
        <Spinner className="sg:size-5" />
        <p className="sg:m-0 sg:text-sm sg:text-muted-foreground">Waiting for import to start…</p>
      </output>
    );
  }
  const percent = jobPercent(job);
  return (
    <div className="sg:mx-auto sg:flex sg:w-full sg:max-w-lg sg:flex-col sg:gap-4 sg:py-10">
      <div className="sg:flex sg:items-center sg:gap-3">
        <StateIcon state={job.state} />
        <p className="sg:m-0 sg:text-base sg:font-medium sg:tabular-nums">
          {`${STATE_TEXT[job.state]} · ${job.processed.toLocaleString()} of ${job.total.toLocaleString()} rows`}
        </p>
        <span className="sg:ml-auto sg:text-sm sg:tabular-nums sg:text-muted-foreground">{`${percent}%`}</span>
      </div>
      {/* biome-ignore lint/a11y/useFocusableInteractive: a read-only progress indicator is not interactive */}
      <div
        role="progressbar"
        aria-label="Import progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        className="sg:h-2 sg:w-full sg:overflow-hidden sg:rounded-full sg:bg-muted"
      >
        <div
          className={cn(
            "sg:h-full sg:rounded-full sg:transition-[width] sg:duration-300 sg:ease-out",
            job.state === "done" ? "sg:bg-success" : job.state === "failed" ? "sg:bg-danger" : "sg:bg-primary",
          )}
          style={{ width: `${percent}%` }}
        />
      </div>
      <div className="sg:flex sg:items-center sg:justify-between sg:gap-3">
        <span className={cn("sg:text-sm sg:tabular-nums", job.errorCount > 0 ? "sg:text-danger" : "sg:text-muted-foreground")}>
          {`${job.errorCount} ${job.errorCount === 1 ? "error" : "errors"}`}
        </span>
        {job.errorReportUrl ? (
          <a href={job.errorReportUrl} download className={buttonVariants({ variant: "secondary", size: "sm" })}>
            <DownloadIcon aria-hidden />
            Download error report
          </a>
        ) : null}
      </div>
    </div>
  );
}
