import { act, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type {
  ColumnMapping,
  ImportJobStatus,
  IoFunctions,
  ParsedFile,
  RowValidationResult,
  ValidateRowsInput,
} from "../internal/io-contracts";
import { FIXTURE_IDS, buildFixtureAccess, buildFixtureRegistry, buildFixtureSchema } from "../test/fixtures";
import { renderWithMantine } from "../test/render";
import { ImportWizard, type ImportWizardProps } from "./ImportWizard";
import type { ImportPlan } from "./import-model";

const HEADERS = ["Payment Status", "Call Date", "Unknown"];

function parsedWith(rows: string[][]): ParsedFile {
  return { fileName: "leads.csv", headers: HEADERS, rows };
}

const TWO_ROWS = parsedWith([
  ["Paid", "2026-01-01", "x"],
  ["Pending", "not-a-date", "y"],
]);

const ok = (rowIndex: number): RowValidationResult => ({ rowIndex, values: {}, errors: [] });

function setup(
  opts: {
    parsed?: ParsedFile;
    validate?: (input: ValidateRowsInput) => RowValidationResult[];
    props?: Partial<ImportWizardProps>;
  } = {},
) {
  const schema = buildFixtureSchema();
  const parsed = opts.parsed ?? TWO_ROWS;
  const io: Partial<IoFunctions> & { validateRows: ReturnType<typeof vi.fn> } = {
    parseFile: vi.fn(async () => parsed),
    autoMapColumns: vi.fn(
      (): ColumnMapping => ({ "Payment Status": FIXTURE_IDS.payment, "Call Date": FIXTURE_IDS.call, Unknown: null }),
    ),
    validateRows: vi.fn(opts.validate ?? ((input: ValidateRowsInput) => input.rows.map((_, i) => ok(i)))),
  };
  const onCommit = vi.fn<(plan: ImportPlan) => void>();
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
  return { ...utils, io, onCommit, rerenderWith };
}

type Utils = ReturnType<typeof setup>;

async function toMap(utils: Utils) {
  const input = utils.container.ownerDocument.querySelector<HTMLInputElement>("input[type=file]");
  if (!input) throw new Error("file input missing");
  await utils.user.upload(input, new File(["x"], "leads.csv", { type: "text/csv" }));
  await screen.findByText("leads.csv");
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
      validate: (input) =>
        input.rows.map((_, i) =>
          i === 1
            ? { rowIndex: 1, values: {}, errors: [{ columnId: FIXTURE_IDS.call, message: "Invalid date", kind: "invalid" as const }] }
            : ok(i),
        ),
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

  it("shows only mapped columns in the preview table", async () => {
    const utils = setup();
    await toPreview(utils);
    const table = screen.getByRole("table");
    expect(within(table).getByRole("columnheader", { name: "Payment status" })).toBeInTheDocument();
    expect(within(table).queryByRole("columnheader", { name: "Unknown" })).not.toBeInTheDocument();
  });

  it("validates only the first 100 rows", async () => {
    const rows = Array.from({ length: 250 }, (_, i) => ["Paid", "2026-01-01", `r${i}`]);
    const utils = setup({ parsed: parsedWith(rows) });
    await toPreview(utils);
    expect(utils.io.validateRows).toHaveBeenCalledTimes(1);
    const input = utils.io.validateRows.mock.calls[0]?.[0] as ValidateRowsInput;
    expect(input.rows).toHaveLength(100);
    expect(input.rows).toEqual(rows.slice(0, 100));
    expect(input.headers).toEqual(HEADERS);
    expect(input.mapping).toEqual({ "Payment Status": FIXTURE_IDS.payment, "Call Date": FIXTURE_IDS.call, Unknown: null });
    expect(input.mode).toBe("create");
    expect(input.keyColumnId).toBeNull();
    expect(input.unknownEnumPolicy).toBe("createOptions");
    expect(input.access?.get(FIXTURE_IDS.payment)).toBe("edit");
  });

  it("shows row-level errors in the row number cell", async () => {
    const utils = setup({
      validate: (input) =>
        input.rows.map((_, i) => (i === 0 ? { rowIndex: 0, values: {}, errors: [], rowError: "No row matches this key" } : ok(i))),
    });
    await toPreview(utils);
    const rowErr = screen.getByText("No row matches this key");
    expect(rowErr.closest("td")).toHaveAttribute("data-row-error", "true");
    expect(screen.getByText(/1 invalid row/)).toBeInTheDocument();
  });

  it("uses onPreview instead of validateRows when provided", async () => {
    const onPreview = vi.fn(async (_plan: ImportPlan) => [ok(0), ok(1)]);
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

  it("the reject policy for unknown enum values reaches the committed plan", async () => {
    const utils = setup({
      validate: (input) =>
        input.rows.map((_, i) =>
          i === 0
            ? {
                rowIndex: 0,
                values: {},
                errors: [{ columnId: FIXTURE_IDS.payment, message: "Unknown option 'Refunded'", kind: "unknownEnum" as const, value: "Refunded" }],
              }
            : ok(i),
        ),
    });
    await toPreview(utils);
    expect(screen.getByText(/1 unknown value/)).toBeInTheDocument();
    expect(screen.getByRole("radiogroup", { name: "Unknown option values" })).toBeInTheDocument();
    await utils.user.click(screen.getByText("Reject rows"));
    await waitFor(() => expect(utils.io.validateRows).toHaveBeenCalledTimes(2));
    expect((utils.io.validateRows.mock.calls[1]?.[0] as ValidateRowsInput).unknownEnumPolicy).toBe("rejectRows");
    await waitFor(() => expect(screen.getByRole("button", { name: "Start import" })).toBeEnabled());
    await utils.user.click(screen.getByRole("button", { name: "Start import" }));
    expect(utils.onCommit).toHaveBeenCalledTimes(1);
    expect(utils.onCommit.mock.calls[0]?.[0].unknownEnumPolicy).toBe("rejectRows");
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
      unknownEnumPolicy: "createOptions",
      mapping: { "Payment Status": FIXTURE_IDS.payment, "Call Date": FIXTURE_IDS.call, Unknown: FIXTURE_IDS.website },
    });
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
});
