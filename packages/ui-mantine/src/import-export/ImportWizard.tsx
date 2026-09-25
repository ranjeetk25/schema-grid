import { Alert, Box, Button, Group, Modal, Stack } from "@mantine/core";
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
import {
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
import { MapStep } from "./steps/MapStep";
import { PreviewStep } from "./steps/PreviewStep";
import { RunStep } from "./steps/RunStep";
import { UploadStep } from "./steps/UploadStep";
import { StepIndicator } from "./StepIndicator";

const STEPS = ["Upload", "Map columns", "Preview", "Import"];

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

const errorMessage = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

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
  const nextEnabled = canProceed(state, schema, access);

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

  // Reset whenever the modal closes, however the parent closed it.
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

  return (
    <Modal
      opened={opened}
      onClose={handleClose}
      title="Import data"
      size={760}
      closeButtonProps={{ "aria-label": "Close import" }}
    >
      <Stack gap="lg">
        <StepIndicator steps={STEPS} active={state.step} aria-label="Import steps" />
        <Box pt={4}>
          {state.step === 0 && (
            <UploadStep
              file={state.file}
              fileName={state.fileName}
              parsing={parsing}
              parseError={state.parseError}
              rowCount={state.parsed?.rows.length ?? null}
              truncated={state.parsed?.truncated ?? false}
              onFile={(f) => void handleFile(f)}
            />
          )}
          {state.step === 1 && state.parsed ? (
              <MapStep
                headers={state.parsed.headers}
                mapping={state.mapping}
                targets={mappingTargets(state, schema, access)}
                matchOnlyColumnId={matchOnlyKeyColumn(state, schema, access)?.id ?? null}
                keyColumns={keyColumns}
                keyColumnId={state.keyColumnId}
                mode={state.mode}
                errors={errors}
                onMappingChange={(headerIndex, columnId) => dispatch({ type: "setMapping", headerIndex, columnId })}
                onKeyColumnChange={(columnId) => dispatch({ type: "setKeyColumn", columnId })}
                onModeChange={(mode) => dispatch({ type: "setMode", mode })}
              />
            ) : null}
          {state.step === 2 && state.parsed ? (
              <PreviewStep
                parsed={state.parsed}
                mapping={state.mapping}
                columns={mappingTargets(state, schema, access)}
                preview={state.preview}
                loading={previewLoading}
                error={state.previewError}
                unknownOptions={state.unknownOptions}
                onPolicyChange={changePolicy}
              />
            ) : null}
          {state.step === 3 && (
            <RunStep job={activeJob} />
          )}
        </Box>
        {commitError ? (
          <Alert color="red" title="Import failed to start">
            {commitError}
          </Alert>
        ) : null}
        <Group justify="space-between" pt="sm" style={{ borderTop: "1px solid var(--mantine-color-default-border)" }}>
          <Box>
            {state.step > 0 && state.step < 3 ? (
              <Button variant="subtle" color="gray" onClick={goBack} disabled={committing}>
                Back
              </Button>
            ) : state.step === 0 ? (
              <Button variant="subtle" color="gray" onClick={handleClose}>
                Cancel
              </Button>
            ) : null}
          </Box>
          {state.step < 2 ? (
            <Button onClick={goNext} disabled={!nextEnabled}>
              Next
            </Button>
          ) : null}
          {state.step === 2 ? (
            <Button onClick={() => void startImport()} disabled={!startEnabled} loading={committing}>
              Start import
            </Button>
          ) : null}
          {state.step === 3 ? <Button onClick={handleClose}>Close</Button> : null}
        </Group>
      </Stack>
    </Modal>
  );
}
