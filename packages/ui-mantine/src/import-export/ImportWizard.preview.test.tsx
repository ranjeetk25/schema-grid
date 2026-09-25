import { act, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  type CellValidation,
  type ColumnMapping,
  type ImportJobStatus,
  ImportConfigError,
  type IoFunctions,
  type ParsedTable,
  type RowValidation,
  type ValidateRowsOptions,
  type ValidationReport,
} from "../internal/io-contracts";
import { FIXTURE_IDS, buildFixtureAccess, buildFixtureRegistry, buildFixtureSchema } from "../test/fixtures";
import { renderWithMantine } from "../test/render";
import { ImportWizard, type ImportWizardProps } from "./ImportWizard";
import type { ImportWizardPlan } from "./import-model";

const HEADERS = ["Payment Status", "Call Date", "Unknown"];

function parsedWith(rows: string[][]): ParsedTable {
  return { headers: HEADERS, rows, truncated: false };
}

const TWO_ROWS = parsedWith([
  ["Paid", "2026-01-01", "x"],
  ["Pending", "not-a-date", "y"],
]);

type CellPatch = Partial<Record<string, Partial<CellValidation>>>;
type RowPatch = { cells?: CellPatch; rowError?: string };

/**
 * io-shaped stub report: every mapped cell echoes its raw text; `patches`
 * (by 0-based row index) add errors/skips/row errors. Summary counts follow.
 */
function stubReport(
  parsed: ParsedTable,
  mapping: ColumnMapping[],
  opts: ValidateRowsOptions,
  patches: Record<number, RowPatch> = {},
  unknownOptions: Record<string, string[]> = {},
): ValidationReport {
  const source = opts.limit !== undefined ? parsed.rows.slice(0, opts.limit) : parsed.rows;
  let valid = 0;
  let invalid = 0;
  const rows = source.map((cellsRaw, index): RowValidation => {
    const cells: Record<string, CellValidation> = {};
    for (const m of mapping) {
      if (m.columnId == null) continue;
      const raw = cellsRaw[m.headerIndex] ?? "";
      cells[m.columnId] = { value: raw, raw, ...patches[index]?.cells?.[m.columnId] };
    }
    const rowError = patches[index]?.rowError;
    const bad = rowError !== undefined || Object.values(cells).some((c) => c.error);
    if (bad) invalid += 1;
    else valid += 1;
    return { index, sourceRow: index + 2, cells, ...(rowError ? { rowError } : {}) };
  });
  const newOptions = opts.unknownOptions === "create" ? unknownOptions : {};
  return { rows, summary: { valid, invalid, newOptions, unknownOptions, unmappedRequired: [] } };
}

type ValidateFn = IoFunctions["validateRows"];

function setup(
  opts: {
    parsed?: ParsedTable;
    validate?: ValidateFn;
    props?: Partial<ImportWizardProps>;
  } = {},
) {
  const schema = buildFixtureSchema();
  const parsed = opts.parsed ?? TWO_ROWS;
  const io = {
    parseFile: vi.fn(async () => parsed),
    autoMapColumns: vi.fn((headers: string[]): ColumnMapping[] =>
      headers.map((header, headerIndex) => {
        const columnId = [FIXTURE_IDS.payment, FIXTURE_IDS.call, null][headerIndex] ?? null;
        return { header, headerIndex, columnId, confidence: columnId ? 0.9 : 0 };
      }),
    ),
    validateRows: vi.fn<ValidateFn>(opts.validate ?? ((p, m, _s, _r, o) => stubReport(p, m, o))),
  };
  const onCommit = vi.fn<(plan: ImportWizardPlan) => void>();
  const base: ImportWizardProps = {
    opened: true,
    onClose: () => {},
    schema,
    registry: buildFixtureRegistry(),
    access: buildFixtureAccess(schema),
    io,
    onCommit,
    ...opts.props,
  };
  const utils = renderWithMantine(<ImportWizard {...base} />);
  const rerenderWith = (extra: Partial<ImportWizardProps>) => utils.rerender(<ImportWizard {...base} {...extra} />);
  return { ...utils, io, onCommit, rerenderWith, schema, access: base.access, registry: base.registry };
}

type Utils = ReturnType<typeof setup>;

async function toMap(utils: Utils, fileName = "leads.csv") {
  const input = utils.container.ownerDocument.querySelector<HTMLInputElement>("input[type=file]");
  if (!input) throw new Error("file input missing");
  await utils.user.upload(input, new File(["x"], fileName, { type: "text/csv" }));
  await screen.findByText(fileName);
  await utils.user.click(screen.getByRole("button", { name: "Next" }));
  await screen.findByRole("textbox", { name: "Map Payment Status" });
}

async function toPreview(utils: Utils) {
  await toMap(utils);
  await utils.user.click(screen.getByRole("button", { name: "Next" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Start import" })).toBeEnabled());
}

describe("ImportWizard preview + run", () => {
  it("marks invalid cells and shows the message in a tooltip", async () => {
    const utils = setup({
      validate: (p, m, _s, _r, o) => stubReport(p, m, o, { 1: { cells: { [FIXTURE_IDS.call]: { value: null, error: "Invalid date" } } } }),
    });
    await toPreview(utils);
    const content = await screen.findByText("not-a-date");
    const cell = content.closest("td");
    expect(cell).not.toBeNull();
    expect(cell).toHaveAttribute("data-error", "true");
    expect(content).toHaveAttribute("aria-invalid", "true");
    expect(content).toHaveAttribute("tabindex", "0");
    expect(screen.getByText("2026-01-01").closest("td")).not.toHaveAttribute("data-error");
    await utils.user.hover(content);
    expect(await screen.findByText("Invalid date")).toBeInTheDocument();
    expect(screen.getByText(/1 valid row/)).toBeInTheDocument();
    expect(screen.getByText(/1 invalid row/)).toBeInTheDocument();
  });

  it("shows skipped update cells as unchanged", async () => {
    const utils = setup({
      validate: (p, m, _s, _r, o) => stubReport(p, m, o, { 0: { cells: { [FIXTURE_IDS.call]: { value: null, raw: "", skip: true } } } }),
    });
    await toPreview(utils);
    const unchanged = screen.getByText("unchanged");
    expect(unchanged.closest("td")).toHaveAttribute("data-skip", "true");
  });

  it("shows only mapped columns in the preview table", async () => {
    const utils = setup();
    await toPreview(utils);
    const table = screen.getByRole("table");
    expect(within(table).getByRole("columnheader", { name: "Payment status" })).toBeInTheDocument();
    expect(within(table).queryByRole("columnheader", { name: "Unknown" })).not.toBeInTheDocument();
  });

  it("validates only the first 100 rows, passing mode, key, policy and access", async () => {
    const rows = Array.from({ length: 250 }, (_, i) => ["Paid", "2026-01-01", `r${i}`]);
    const parsed = parsedWith(rows);
    const utils = setup({ parsed });
    await toPreview(utils);
    expect(utils.io.validateRows).toHaveBeenCalledTimes(1);
    const [p, mapping, schemaArg, registryArg, o] = utils.io.validateRows.mock.calls[0] ?? [];
    expect(p).toBe(parsed);
    expect(mapping?.map((m) => m.columnId)).toEqual([FIXTURE_IDS.payment, FIXTURE_IDS.call, null]);
    expect(schemaArg).toBe(utils.schema);
    expect(registryArg).toBe(utils.registry);
    expect(o).toEqual({ mode: "create", keyColumnId: undefined, unknownOptions: "create", limit: 100, access: utils.access });
    expect(screen.getAllByRole("row")).toHaveLength(101); // header + 100
    expect(screen.getByText("Previewing the first 100 of 250 rows.")).toBeInTheDocument();
  });

  it("shows ImportConfigError from validateRows inline", async () => {
    const utils = setup({
      validate: () => {
        throw new ImportConfigError('Key column "col_website" must be mapped in "update" mode');
      },
    });
    await toMap(utils);
    await utils.user.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByRole("alert")).toHaveTextContent('Key column "col_website" must be mapped');
    expect(screen.getByRole("button", { name: "Start import" })).toBeDisabled();
  });

  it("shows row-level errors in the row number cell", async () => {
    const utils = setup({
      validate: (p, m, _s, _r, o) => stubReport(p, m, o, { 0: { rowError: "Duplicate key (first seen on row 2)" } }),
    });
    await toPreview(utils);
    const rowErr = screen.getByText("Duplicate key (first seen on row 2)");
    expect(rowErr.closest("td")).toHaveAttribute("data-row-error", "true");
    expect(screen.getByText(/1 invalid row/)).toBeInTheDocument();
  });

  it("uses onPreview instead of validateRows when provided", async () => {
    const onPreview = vi.fn(async (plan: ImportWizardPlan) =>
      stubReport(plan.parsed, plan.mapping, { mode: plan.mode, unknownOptions: plan.unknownOptions }),
    );
    const utils = setup({ props: { onPreview } });
    await toPreview(utils);
    expect(onPreview).toHaveBeenCalledTimes(1);
    expect(onPreview.mock.calls[0]?.[0].parsed).toBe(TWO_ROWS);
    expect(utils.io.validateRows).not.toHaveBeenCalled();
    expect(screen.getByText(/2 valid rows/)).toBeInTheDocument();
  });

  it("shows preview failures inline", async () => {
    const utils = setup({
      props: { onPreview: async () => Promise.reject(new Error("Server said no")) },
    });
    await toMap(utils);
    await utils.user.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Server said no");
    expect(screen.getByRole("button", { name: "Start import" })).toBeDisabled();
  });

  it("the reject policy for unknown options re-validates and reaches the committed plan", async () => {
    const utils = setup({
      validate: (p, m, _s, _r, o) =>
        o.unknownOptions === "reject"
          ? stubReport(
              p,
              m,
              o,
              { 0: { cells: { [FIXTURE_IDS.payment]: { value: null, error: 'Unknown option "Refunded"', errorKind: "unknownOption" } } } },
              { [FIXTURE_IDS.payment]: ["Refunded"] },
            )
          : stubReport(p, m, o, {}, { [FIXTURE_IDS.payment]: ["Refunded"] }),
    });
    await toPreview(utils);
    expect(screen.getByText(/1 unknown value/)).toBeInTheDocument();
    expect(screen.getByRole("radiogroup", { name: "Unknown option values" })).toBeInTheDocument();
    await utils.user.click(screen.getByText("Reject rows"));
    await waitFor(() => expect(utils.io.validateRows).toHaveBeenCalledTimes(2));
    expect(utils.io.validateRows.mock.calls[1]?.[4].unknownOptions).toBe("reject");
    await waitFor(() => expect(screen.getByRole("button", { name: "Start import" })).toBeEnabled());
    // Still offered after switching, so the user can switch back.
    expect(screen.getByText("Create options")).toBeInTheDocument();
    expect(screen.getByText(/1 invalid row/)).toBeInTheDocument();
    await utils.user.click(screen.getByRole("button", { name: "Start import" }));
    expect(utils.onCommit).toHaveBeenCalledTimes(1);
    expect(utils.onCommit.mock.calls[0]?.[0].unknownOptions).toBe("reject");
  });

  it("hides the enum policy control when there are no unknown values", async () => {
    const utils = setup();
    await toPreview(utils);
    expect(screen.queryByText("Reject rows")).not.toBeInTheDocument();
  });

  it("onCommit receives mapping, mode and key column", async () => {
    const utils = setup();
    await toMap(utils);
    await utils.user.click(screen.getByText("Upsert"));
    await utils.user.click(screen.getByRole("textbox", { name: "Key column" }));
    await utils.user.click(within(await screen.findByRole("listbox")).getByRole("option", { name: "Website" }));
    await utils.user.click(screen.getByRole("textbox", { name: "Map Unknown" }));
    await utils.user.click(within(await screen.findByRole("listbox")).getByRole("option", { name: "Website" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Next" })).toBeEnabled());
    await utils.user.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Start import" })).toBeEnabled());
    await utils.user.click(screen.getByRole("button", { name: "Start import" }));
    expect(utils.onCommit).toHaveBeenCalledTimes(1);
    const plan = utils.onCommit.mock.calls[0]?.[0];
    expect(plan).toMatchObject({
      fileName: "leads.csv",
      mode: "upsert",
      keyColumnId: FIXTURE_IDS.website,
      unknownOptions: "create",
    });
    expect(plan?.mapping).toEqual([
      { header: "Payment Status", headerIndex: 0, columnId: FIXTURE_IDS.payment, confidence: 0.9 },
      { header: "Call Date", headerIndex: 1, columnId: FIXTURE_IDS.call, confidence: 0.9 },
      { header: "Unknown", headerIndex: 2, columnId: FIXTURE_IDS.website, confidence: 1 },
    ]);
    const validateOpts = utils.io.validateRows.mock.calls[0]?.[4];
    expect(validateOpts).toMatchObject({ mode: "upsert", keyColumnId: FIXTURE_IDS.website });
    expect(plan?.parsed).toBe(TWO_ROWS);
    expect(plan?.file).toBeInstanceOf(File);
    expect(await screen.findByText("Waiting for import to start…")).toBeInTheDocument();
  });

  it("shows job progress and the error report link", async () => {
    const utils = setup();
    await toPreview(utils);
    await utils.user.click(screen.getByRole("button", { name: "Start import" }));
    await screen.findByText("Waiting for import to start…");

    const running: ImportJobStatus = { state: "running", processed: 50, total: 200, errorCount: 3 };
    utils.rerenderWith({ job: running });
    const bar = screen.getByRole("progressbar", { name: "Import progress" });
    expect(bar).toHaveAttribute("aria-valuenow", "25");
    expect(screen.getByText(/Running/)).toBeInTheDocument();
    expect(screen.getByText(/3 errors/)).toBeInTheDocument();
    expect(screen.queryByText("Download error report")).not.toBeInTheDocument();

    utils.rerenderWith({
      job: { state: "done", processed: 200, total: 200, errorCount: 3, errorReportUrl: "https://example.com/errors.csv" },
    });
    expect(screen.getByRole("progressbar", { name: "Import progress" })).toHaveAttribute("aria-valuenow", "100");
    const link = screen.getByRole("link", { name: "Download error report" });
    expect(link).toHaveAttribute("href", "https://example.com/errors.csv");
    expect(link).toHaveAttribute("download");
  });

  it("surfaces commit failures and stays on preview", async () => {
    const utils = setup({ props: { onCommit: vi.fn(async () => Promise.reject(new Error("Queue down"))) } });
    await toPreview(utils);
    await utils.user.click(screen.getByRole("button", { name: "Start import" }));
    expect(await screen.findByText("Queue down")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start import" })).toBeEnabled();
  });

  it("closing on the run step without a job resets the wizard", async () => {
    const utils = setup();
    await toPreview(utils);
    await utils.user.click(screen.getByRole("button", { name: "Start import" }));
    await screen.findByText("Waiting for import to start…");
    utils.rerenderWith({ opened: false });
    utils.rerenderWith({ opened: true });
    expect(await screen.findByRole("button", { name: "Choose file" })).toBeInTheDocument();
    expect(screen.queryByText("Waiting for import to start…")).not.toBeInTheDocument();
  });

  it("keeps an in-flight import across close and reopen", async () => {
    const utils = setup();
    await toPreview(utils);
    await utils.user.click(screen.getByRole("button", { name: "Start import" }));
    await screen.findByText("Waiting for import to start…");
    const running: ImportJobStatus = { state: "running", processed: 10, total: 100, errorCount: 0 };
    utils.rerenderWith({ job: running });
    utils.rerenderWith({ job: running, opened: false });
    utils.rerenderWith({ job: running, opened: true });
    expect(screen.getByRole("progressbar", { name: "Import progress" })).toHaveAttribute("aria-valuenow", "10");
  });

  it("ignores a job that was passed before the commit", async () => {
    const stale: ImportJobStatus = {
      state: "done",
      processed: 5,
      total: 5,
      errorCount: 1,
      errorReportUrl: "https://example.com/old.csv",
    };
    const utils = setup({ props: { job: stale } });
    await toPreview(utils);
    await utils.user.click(screen.getByRole("button", { name: "Start import" }));
    expect(await screen.findByText("Waiting for import to start…")).toBeInTheDocument();
    expect(screen.queryByText("Download error report")).not.toBeInTheDocument();
    utils.rerenderWith({ job: { state: "queued", processed: 0, total: 2, errorCount: 0 } });
    expect(screen.getByText(/Queued/)).toBeInTheDocument();
  });

  it("drops a commit that settles after the wizard was closed", async () => {
    let resolveCommit: () => void = () => {};
    const onCommit = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveCommit = resolve;
        }),
    );
    const utils = setup({ props: { onCommit } });
    await toPreview(utils);
    await utils.user.click(screen.getByRole("button", { name: "Start import" }));
    expect(onCommit).toHaveBeenCalledTimes(1);
    utils.rerenderWith({ opened: false });
    await act(async () => {
      resolveCommit();
    });
    utils.rerenderWith({ opened: true });
    expect(await screen.findByRole("button", { name: "Choose file" })).toBeInTheDocument();
    expect(screen.queryByText("Waiting for import to start…")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
  });

  it("runs end to end with the real io: parse, auto-map, validate, reject unknown options, commit", async () => {
    const schema = buildFixtureSchema();
    const access = buildFixtureAccess(schema);
    const onCommit = vi.fn<(plan: ImportWizardPlan) => void>();
    const { user, container } = renderWithMantine(
      <ImportWizard opened onClose={() => {}} schema={schema} registry={buildFixtureRegistry()} access={access} onCommit={onCommit} />,
    );
    const csv = "Payment Status,Notes,Website\nPaid,hello,https://a.example.com\nRefunded,bye,https://b.example.com\n";
    const input = container.ownerDocument.querySelector<HTMLInputElement>("input[type=file]");
    if (!input) throw new Error("file input missing");
    await user.upload(input, new File([csv], "leads.csv", { type: "text/csv" }));
    expect(await screen.findByText("2 rows found")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Next" }));

    expect(await screen.findByRole("textbox", { name: "Map Payment Status" })).toHaveValue("Payment status");
    expect(screen.getByRole("textbox", { name: "Map Notes" })).toHaveValue("Notes");
    expect(screen.getByRole("textbox", { name: "Map Website" })).toHaveValue("Website");
    await user.click(screen.getByRole("button", { name: "Next" }));

    // Default policy creates the unknown option.
    expect(await screen.findByText(/1 unknown value/)).toBeInTheDocument();
    expect(screen.getByText(/2 valid rows/)).toBeInTheDocument();

    await user.click(screen.getByText("Reject rows"));
    await waitFor(() => expect(screen.getByText(/1 invalid row/)).toBeInTheDocument());
    const bad = screen.getByText("Refunded");
    expect(bad.closest("td")).toHaveAttribute("data-error", "true");
    await user.hover(bad);
    expect(await screen.findByText('Unknown option "Refunded"')).toBeInTheDocument();
    expect(screen.getByText("Paid").closest("td")).not.toHaveAttribute("data-error");

    await waitFor(() => expect(screen.getByRole("button", { name: "Start import" })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: "Start import" }));
    expect(onCommit).toHaveBeenCalledTimes(1);
    const plan = onCommit.mock.calls[0]?.[0];
    expect(plan).toMatchObject({ fileName: "leads.csv", mode: "create", keyColumnId: null, unknownOptions: "reject" });
    expect(plan?.parsed.headers).toEqual(["Payment Status", "Notes", "Website"]);
    expect(plan?.parsed.rows).toHaveLength(2);
    expect(plan?.mapping.map((m) => m.columnId)).toEqual([FIXTURE_IDS.payment, FIXTURE_IDS.notes, FIXTURE_IDS.website]);
    expect(await screen.findByText("Waiting for import to start…")).toBeInTheDocument();
  });
});
