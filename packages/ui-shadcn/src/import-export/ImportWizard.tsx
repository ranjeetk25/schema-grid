import { CheckIcon } from "lucide-react";
import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { AccessMap } from "../internal/access";
import type { FieldTypeRegistry, GridSchema } from "../internal/core-contracts";
import {
  type ImportJobStatus,
  type IoFunctions,
  type UnknownOptionsPolicy,
  type ValidationReport,
  defaultIo,
} from "../internal/io-contracts";
import { SG_ROOT, cn } from "../lib/cn";
import { Button } from "../ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../ui/dialog";
import {
  type ImportStep,
  type ImportWizardPlan,
  PREVIEW_ROW_LIMIT,
  buildImportPlan,
  canProceed,
  importReducer,
  initialImportState,
  keyColumnOptions,
  mappingErrors,
  mappingTargets,
  matchOnlyKeyColumn,
  sanitizeMapping,
  targetColumns,
} from "./import-model";
import { InlineAlert, Spinner } from "./parts";
import { MapStep } from "./steps/MapStep";
import { PreviewStep } from "./steps/PreviewStep";
import { RunStep } from "./steps/RunStep";
import { UploadStep } from "./steps/UploadStep";

export interface ImportWizardProps {
  opened: boolean;
  onClose(): void;
  schema: GridSchema;
  registry: FieldTypeRegistry;
  access: AccessMap;
  /** Injectable io functions; missing ones fall back to `@ranjeetk25/schema-grid-io`. */
  io?: Partial<IoFunctions>;
  /** Server-mode override for the preview; replaces the local `validateRows`. */
  onPreview?(plan: ImportWizardPlan): Promise<ValidationReport>;
  onCommit(plan: ImportWizardPlan): void | Promise<void>;
  job?: ImportJobStatus;
}

const STEPS: { label: string; hint: string }[] = [
  { label: "Upload", hint: "Choose a CSV or Excel file to import." },
  { label: "Map columns", hint: "Match each file column to a grid column." },
  { label: "Preview", hint: "Check the first rows before anything is written." },
  { label: "Import", hint: "Rows are being written to the grid." },
];

const errorMessage = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

function Stepper({ active }: { active: ImportStep }) {
  return (
    <ol aria-label="Import steps" className="sg:m-0 sg:flex sg:list-none sg:items-center sg:gap-2 sg:p-0">
      {STEPS.map((step, index) => {
        const state = index < active ? "complete" : index === active ? "current" : "upcoming";
        return (
          <li
            key={step.label}
            data-state={state}
            aria-current={state === "current" ? "step" : undefined}
            className="sg:flex sg:min-w-0 sg:flex-1 sg:items-center sg:gap-2 sg:last:flex-none"
          >
            <span className="sg:flex sg:shrink-0 sg:items-center sg:gap-2">
              <span
                aria-hidden
                className={cn(
                  "sg:flex sg:size-5 sg:items-center sg:justify-center sg:rounded-full sg:text-2xs sg:font-semibold sg:tabular-nums sg:transition-colors sg:duration-150",
                  state === "complete" && "sg:bg-primary sg:text-primary-foreground",
                  state === "current" && "sg:bg-foreground sg:text-background",
                  state === "upcoming" && "sg:border sg:border-input sg:text-muted-foreground",
                )}
              >
                {state === "complete" ? <CheckIcon className="sg:size-3" strokeWidth={3} /> : index + 1}
              </span>
              <span
                className={cn(
                  "sg:text-sm sg:whitespace-nowrap",
                  state === "current" ? "sg:font-medium sg:text-foreground" : "sg:text-muted-foreground",
                )}
              >
                {step.label}
                {state === "complete" ? <span className="sg:sr-only"> (completed)</span> : null}
              </span>
            </span>
            {index < STEPS.length - 1 ? (
              <span
                aria-hidden
                className={cn("sg:h-px sg:min-w-4 sg:flex-1", index < active ? "sg:bg-primary" : "sg:bg-border")}
              />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

export function ImportWizard({
  opened,
  onClose,
  schema,
  registry,
  access,
  io: ioOverrides,
  onPreview,
  onCommit,
  job,
}: ImportWizardProps) {
  const io = useMemo<IoFunctions>(() => ({ ...defaultIo, ...ioOverrides }), [ioOverrides]);
  const [state, dispatch] = useReducer(importReducer, undefined, initialImportState);
  const [parsing, setParsing] = useState(false);
  const parseToken = useRef(0);
  const previewToken = useRef(0);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [commitError, setCommitError] = useState<string | null>(null);
  const commitToken = useRef(0);
  const jobAtCommit = useRef<ImportJobStatus | undefined>(undefined);

  const targets = useMemo(() => targetColumns(schema, access), [schema, access]);
  const keyColumns = useMemo(() => keyColumnOptions(schema, access), [schema, access]);
  const errors = useMemo(() => mappingErrors(state, schema, access), [state, schema, access]);
  const nextEnabled = canProceed(state, schema, access) && !parsing;

  const handleFile = async (file: File) => {
    const token = ++parseToken.current;
    dispatch({ type: "fileSelected", file, fileName: file.name });
    setParsing(true);
    try {
      const parsed = await io.parseFile(file);
      if (token !== parseToken.current) return;
      const auto = io.autoMapColumns(parsed.headers, schema, access);
      dispatch({ type: "parsed", parsed, mapping: sanitizeMapping(parsed.headers, auto, targets) });
    } catch (e) {
      if (token !== parseToken.current) return;
      dispatch({ type: "parseFailed", error: errorMessage(e, "Could not read file") });
    } finally {
      if (token === parseToken.current) setParsing(false);
    }
  };

  const runPreview = async (overrides: Partial<Pick<ImportWizardPlan, "unknownOptions">> = {}) => {
    const base = buildImportPlan(state);
    if (!base) return;
    const plan: ImportWizardPlan = { ...base, ...overrides };
    const token = ++previewToken.current;
    setPreviewLoading(true);
    try {
      const preview = onPreview
        ? await onPreview(plan)
        : // Synchronous and throws ImportConfigError for an unusable mapping; the catch shows it inline.
          io.validateRows(plan.parsed, plan.mapping, schema, registry, {
            mode: plan.mode,
            keyColumnId: plan.keyColumnId ?? undefined,
            unknownOptions: plan.unknownOptions,
            limit: PREVIEW_ROW_LIMIT,
            access,
          });
      if (token !== previewToken.current) return;
      dispatch({ type: "previewLoaded", preview });
    } catch (e) {
      if (token !== previewToken.current) return;
      dispatch({ type: "previewFailed", error: errorMessage(e, "Could not validate rows") });
    } finally {
      if (token === previewToken.current) setPreviewLoading(false);
    }
  };

  const goNext = () => {
    if (state.step === 0) dispatch({ type: "goTo", step: 1 });
    else if (state.step === 1) {
      dispatch({ type: "goTo", step: 2 });
      setCommitError(null);
      void runPreview();
    }
  };

  const goBack = () => {
    if (state.step === 2) {
      previewToken.current += 1;
      setPreviewLoading(false);
      dispatch({ type: "goTo", step: 1 });
    } else if (state.step === 1) dispatch({ type: "goTo", step: 0 });
  };

  const changePolicy = (policy: UnknownOptionsPolicy) => {
    if (policy === state.unknownOptions) return;
    dispatch({ type: "setPolicy", policy });
    void runPreview({ unknownOptions: policy });
  };

  const startImport = async () => {
    const plan = buildImportPlan(state);
    if (!plan) return;
    const token = ++commitToken.current;
    // A job passed before this commit belongs to an earlier import; ignore it until it changes.
    jobAtCommit.current = job;
    setCommitting(true);
    setCommitError(null);
    try {
      await onCommit(plan);
      if (token !== commitToken.current) return;
      dispatch({ type: "goTo", step: 3 });
    } catch (e) {
      if (token !== commitToken.current) return;
      setCommitError(errorMessage(e, "Import could not be started"));
    } finally {
      if (token === commitToken.current) setCommitting(false);
    }
  };

  const activeJob = state.step === 3 && job !== jobAtCommit.current ? job : undefined;
  const importInFlight = activeJob != null && (activeJob.state === "queued" || activeJob.state === "running");

  const resetIfIdle = () => {
    if (importInFlight) return;
    parseToken.current += 1;
    previewToken.current += 1;
    commitToken.current += 1;
    jobAtCommit.current = undefined;
    setParsing(false);
    setPreviewLoading(false);
    setCommitting(false);
    setCommitError(null);
    dispatch({ type: "reset" });
  };
  const resetIfIdleRef = useRef(resetIfIdle);
  resetIfIdleRef.current = resetIfIdle;

  // Reset whenever the dialog closes, however the parent closed it.
  const wasOpened = useRef(opened);
  useEffect(() => {
    if (wasOpened.current && !opened) resetIfIdleRef.current();
    wasOpened.current = opened;
  }, [opened]);

  const handleClose = () => {
    resetIfIdle();
    onClose();
  };

  const startEnabled = state.step === 2 && canProceed(state, schema, access) && !previewLoading && !committing;
  const matchOnlyColumnId = matchOnlyKeyColumn(state, schema, access)?.id ?? null;
  const mapTargets = mappingTargets(state, schema, access);

  return (
    <Dialog
      open={opened}
      onOpenChange={(open) => {
        if (!open) handleClose();
      }}
    >
      <DialogContent size="xl" closeLabel="Close import" className={cn(SG_ROOT, "sg:h-[min(720px,calc(100dvh-48px))]")}>
        <DialogHeader className="sg:gap-4 sg:border-b sg:border-border sg:pb-5">
          <div className="sg:flex sg:flex-col sg:gap-1">
            <DialogTitle>Import data</DialogTitle>
            <DialogDescription>{STEPS[state.step]?.hint}</DialogDescription>
          </div>
          <Stepper active={state.step} />
        </DialogHeader>
        <DialogBody className="sg:flex sg:flex-col sg:gap-4 sg:pt-6">
          {state.step === 0 ? (
            <UploadStep
              file={state.file}
              fileName={state.fileName}
              parsing={parsing}
              parseError={state.parseError}
              rowCount={state.parsed?.rows.length ?? null}
              truncated={state.parsed?.truncated ?? false}
              onFile={(f) => void handleFile(f)}
            />
          ) : null}
          {state.step === 1 && state.parsed ? (
            <MapStep
              headers={state.parsed.headers}
              mapping={state.mapping}
              targets={mapTargets}
              matchOnlyColumnId={matchOnlyColumnId}
              keyColumns={keyColumns}
              keyColumnId={state.keyColumnId}
              mode={state.mode}
              errors={errors}
              sampleRow={state.parsed.rows[0]}
              onMappingChange={(headerIndex, columnId) => dispatch({ type: "setMapping", headerIndex, columnId })}
              onKeyColumnChange={(columnId) => dispatch({ type: "setKeyColumn", columnId })}
              onModeChange={(mode) => dispatch({ type: "setMode", mode })}
            />
          ) : null}
          {state.step === 2 && state.parsed ? (
            <PreviewStep
              parsed={state.parsed}
              mapping={state.mapping}
              columns={mapTargets}
              preview={state.preview}
              loading={previewLoading}
              error={state.previewError}
              unknownOptions={state.unknownOptions}
              onPolicyChange={changePolicy}
            />
          ) : null}
          {state.step === 3 ? <RunStep job={activeJob} /> : null}
          {commitError ? <InlineAlert title="Import failed to start">{commitError}</InlineAlert> : null}
        </DialogBody>
        <DialogFooter className="sg:justify-between">
          <div>
            {state.step > 0 && state.step < 3 ? (
              <Button variant="ghost" onClick={goBack} disabled={committing}>
                Back
              </Button>
            ) : null}
          </div>
          <div className="sg:flex sg:items-center sg:gap-2">
            {state.step < 2 ? (
              <Button variant="primary" onClick={goNext} disabled={!nextEnabled}>
                Continue
              </Button>
            ) : null}
            {state.step === 2 ? (
              <Button variant="primary" onClick={() => void startImport()} disabled={!startEnabled} aria-busy={committing || undefined}>
                {committing ? <Spinner className="sg:text-primary-foreground" /> : null}
                Start import
              </Button>
            ) : null}
            {state.step === 3 ? (
              <Button variant="primary" onClick={handleClose}>
                Done
              </Button>
            ) : null}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
