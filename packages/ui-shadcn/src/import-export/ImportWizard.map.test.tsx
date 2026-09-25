import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Access } from "../internal/core-contracts";
import type { ColumnMapping, IoFunctions, ParsedTable, ValidationReport } from "../internal/io-contracts";
import { FIXTURE_IDS, buildFixtureAccess, buildFixtureRegistry, buildFixtureSchema } from "../test/fixtures";
import { renderUi } from "../test/render";
import { ImportWizard } from "./ImportWizard";

const PARSED: ParsedTable = {
  headers: ["Payment Status", "Call Date", "Unknown"],
  rows: [["Paid", "2026-01-01", "x"]],
  truncated: false,
};

/** io-shaped auto-map result: one entry per header, in order. */
function mapOf(headers: string[], ids: (string | null)[]): ColumnMapping[] {
  return headers.map((header, headerIndex) => {
    const columnId = ids[headerIndex] ?? null;
    return { header, headerIndex, columnId, confidence: columnId ? 0.9 : 0 };
  });
}

const EMPTY_REPORT: ValidationReport = { rows: [], summary: { valid: 0, invalid: 0, newOptions: {}, unknownOptions: {}, unmappedRequired: [] } };

function setup(ioOverrides: Partial<IoFunctions> = {}, accessOverrides: Record<string, Access> = {}) {
  const schema = buildFixtureSchema();
  const access = new Map(buildFixtureAccess(schema));
  for (const [id, a] of Object.entries(accessOverrides)) access.set(id, a);
  const io = {
    parseFile: vi.fn(async () => PARSED),
    autoMapColumns: vi.fn((headers: string[]) => mapOf(headers, [FIXTURE_IDS.payment, FIXTURE_IDS.call, null])),
    validateRows: vi.fn(() => EMPTY_REPORT),
    ...ioOverrides,
  };
  const onCommit = vi.fn();
  const utils = renderUi(
    <ImportWizard
      opened
      onClose={() => {}}
      schema={schema}
      registry={buildFixtureRegistry()}
      access={access}
      io={io}
      onCommit={onCommit}
    />,
  );
  return { ...utils, io, onCommit, schema, access };
}

function fileInput(container: HTMLElement): HTMLInputElement {
  const input = container.ownerDocument.querySelector<HTMLInputElement>("input[type=file]");
  if (!input) throw new Error("file input missing");
  return input;
}

async function uploadAndGoToMap(utils: ReturnType<typeof setup>) {
  const file = new File(["a,b\n1,2"], "leads.csv", { type: "text/csv" });
  await utils.user.upload(fileInput(utils.container), file);
  await screen.findByText("leads.csv");
  await utils.user.click(screen.getByRole("button", { name: "Continue" }));
  await screen.findByRole("combobox", { name: "Map Payment Status" });
}

describe("ImportWizard upload + mapping", () => {
  it("accepts csv and xlsx files", () => {
    const utils = setup();
    expect(fileInput(utils.container).getAttribute("accept")).toBe(
      ".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
  });

  it("shows file name and size after upload", async () => {
    const utils = setup();
    const file = new File(["a".repeat(2048)], "leads.csv", { type: "text/csv" });
    await utils.user.upload(fileInput(utils.container), file);
    expect(await screen.findByText("leads.csv")).toBeInTheDocument();
    expect(screen.getByText("2.0 KB")).toBeInTheDocument();
    expect(utils.io.parseFile).toHaveBeenCalledWith(file);
  });

  it("shows parse errors inline", async () => {
    const utils = setup({
      parseFile: vi.fn(async () => {
        throw new Error("Could not read file");
      }),
    });
    await utils.user.upload(fileInput(utils.container), new File(["x"], "bad.csv", { type: "text/csv" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not read file");
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
  });

  it("auto-maps known headers and skips the unknown one", async () => {
    const utils = setup();
    await uploadAndGoToMap(utils);
    expect(utils.io.autoMapColumns).toHaveBeenCalledWith(PARSED.headers, utils.schema, utils.access);
    expect(screen.getByRole("combobox", { name: "Map Payment Status" })).toHaveTextContent("Payment status");
    expect(screen.getByRole("combobox", { name: "Map Call Date" })).toHaveTextContent("Call status");
    expect(screen.getByRole("combobox", { name: "Map Unknown" })).toHaveTextContent("Skip");
  });

  it("drops auto-mapped targets that are not importable", async () => {
    const utils = setup({
      autoMapColumns: vi.fn((headers: string[]) => mapOf(headers, [FIXTURE_IDS.total, FIXTURE_IDS.secret, FIXTURE_IDS.notes])),
    });
    await uploadAndGoToMap(utils);
    expect(screen.getByRole("combobox", { name: "Map Payment Status" })).toHaveTextContent("Skip");
    expect(screen.getByRole("combobox", { name: "Map Call Date" })).toHaveTextContent("Skip");
    expect(screen.getByRole("combobox", { name: "Map Unknown" })).toHaveTextContent("Notes");
  });

  it("does not offer formula or hidden columns as targets", async () => {
    const utils = setup();
    await uploadAndGoToMap(utils);
    await utils.user.click(screen.getByRole("combobox", { name: "Map Unknown" }));
    const listbox = await screen.findByRole("listbox");
    const names = within(listbox)
      .getAllByRole("option")
      .map((o) => o.textContent);
    expect(names).toContain("Skip");
    expect(names).toContain("Notes");
    expect(names).not.toContain("Total");
    expect(names).not.toContain("Secret");
  });

  it("changing a mapping updates the selection", async () => {
    const utils = setup();
    await uploadAndGoToMap(utils);
    await utils.user.click(screen.getByRole("combobox", { name: "Map Unknown" }));
    await utils.user.click(await screen.findByRole("option", { name: "Notes" }));
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Map Unknown" })).toHaveTextContent("Notes"));
    expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled();
  });

  it("flags duplicate target mappings and blocks Next", async () => {
    const utils = setup();
    await uploadAndGoToMap(utils);
    await utils.user.click(screen.getByRole("combobox", { name: "Map Unknown" }));
    await utils.user.click(await screen.findByRole("option", { name: "Payment status" }));
    expect(await screen.findAllByText(/Duplicate target: Payment status/)).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
  });

  it("upsert without a key column blocks Next with an error", async () => {
    const utils = setup();
    await uploadAndGoToMap(utils);
    await utils.user.click(screen.getByText("Upsert"));
    expect(await screen.findByText("A key column is required for update and upsert")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();

    await utils.user.click(screen.getByRole("combobox", { name: "Key column" }));
    const listbox = await screen.findByRole("listbox");
    const keyNames = within(listbox)
      .getAllByRole("option")
      .map((o) => o.textContent);
    expect(keyNames).not.toContain("Total");
    expect(keyNames).not.toContain("Secret");
    // Only key types (text/longText/email/phone/url) can be keys.
    expect(keyNames).not.toContain("Payment status");
    expect(keyNames).not.toContain("Call status");
    expect(keyNames).toContain("Notes");
    await utils.user.click(within(listbox).getByRole("option", { name: "Website" }));
    expect(await screen.findByText("Map a file column to the key column")).toBeInTheDocument();
    expect(screen.queryByText("A key column is required for update and upsert")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();

    await utils.user.click(screen.getByRole("combobox", { name: "Map Unknown" }));
    await utils.user.click(within(await screen.findByRole("listbox")).getByRole("option", { name: "Website" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled());
    expect(screen.queryByText("Map a file column to the key column")).not.toBeInTheDocument();
  });

  it("a read-only key column is offered as a match-only target", async () => {
    const utils = setup({}, { [FIXTURE_IDS.website]: "read" });
    await uploadAndGoToMap(utils);
    await utils.user.click(screen.getByRole("combobox", { name: "Map Unknown" }));
    let names = within(await screen.findByRole("listbox"))
      .getAllByRole("option")
      .map((o) => o.textContent);
    expect(names.some((n) => n?.startsWith("Website"))).toBe(false);
    await utils.user.keyboard("{Escape}");

    await utils.user.click(screen.getByRole("radio", { name: "Update" }));
    await utils.user.click(screen.getByRole("combobox", { name: "Key column" }));
    await utils.user.click(within(await screen.findByRole("listbox")).getByRole("option", { name: "Website" }));
    expect(await screen.findByText("Map a file column to the key column")).toBeInTheDocument();

    await utils.user.click(screen.getByRole("combobox", { name: "Map Unknown" }));
    const listbox = await screen.findByRole("listbox");
    names = within(listbox)
      .getAllByRole("option")
      .map((o) => o.textContent);
    expect(names).toContain("Website (key, match only)");
    await utils.user.click(within(listbox).getByRole("option", { name: "Website (key, match only)" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled());
  });

  it("flags duplicate and blank headers in the file", async () => {
    const utils = setup({
      parseFile: vi.fn(async (): Promise<ParsedTable> => ({ headers: ["Email", "Email", ""], rows: [], truncated: false })),
      autoMapColumns: vi.fn((): ColumnMapping[] => []),
    });
    const file = new File(["x"], "leads.csv", { type: "text/csv" });
    await utils.user.upload(fileInput(utils.container), file);
    await screen.findByText("leads.csv");
    await utils.user.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findAllByText(/Duplicate header "Email"/)).toHaveLength(2);
    expect(screen.getByText(/Blank header/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
  });

  it("labels the import mode control", async () => {
    const utils = setup();
    await uploadAndGoToMap(utils);
    expect(screen.getByRole("radiogroup", { name: "Import mode" })).toBeInTheDocument();
  });

  it("resets the file input after each selection so the same file can be picked again", async () => {
    const utils = setup();
    const input = fileInput(utils.container);
    const file = new File(["x"], "leads.csv", { type: "text/csv" });
    await utils.user.upload(input, file);
    await screen.findByText("leads.csv");
    expect(input.value).toBe("");
  });
});

describe("ImportWizard shadcn chrome", () => {
  it("accepts a dropped file on the drop zone", async () => {
    const utils = setup();
    const file = new File(["a,b\n1,2"], "dropped.csv", { type: "text/csv" });
    fireEvent.drop(screen.getByTestId("import-drop-zone"), { dataTransfer: { files: [file], dropEffect: "copy" } });
    expect(await screen.findByText("dropped.csv")).toBeInTheDocument();
    expect(utils.io.parseFile).toHaveBeenCalledWith(file);
    await waitFor(() => expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled());
  });

  it("rejects a dropped file of an unsupported type without parsing it", async () => {
    const utils = setup();
    const file = new File(["x"], "notes.pdf", { type: "application/pdf" });
    fireEvent.drop(screen.getByTestId("import-drop-zone"), { dataTransfer: { files: [file] } });
    expect(await screen.findByRole("alert")).toHaveTextContent('"notes.pdf" is not a CSV or Excel (.xlsx) file');
    expect(utils.io.parseFile).not.toHaveBeenCalled();
  });

  it("shows the file row count and the step progress", async () => {
    const utils = setup();
    const steps = screen.getByRole("list", { name: "Import steps" });
    expect(within(steps).getAllByRole("listitem")[0]).toHaveAttribute("aria-current", "step");
    await utils.user.upload(fileInput(utils.container), new File(["x"], "leads.csv", { type: "text/csv" }));
    expect(await screen.findByText("1 row found")).toBeInTheDocument();
    await utils.user.click(screen.getByRole("button", { name: "Continue" }));
    await screen.findByRole("combobox", { name: "Map Payment Status" });
    const items = within(screen.getByRole("list", { name: "Import steps" })).getAllByRole("listitem");
    expect(items[0]).toHaveAttribute("data-state", "complete");
    expect(items[1]).toHaveAttribute("aria-current", "step");
  });

  it("marks auto-mapped rows and not user-mapped ones", async () => {
    const utils = setup();
    await uploadAndGoToMap(utils);
    expect(screen.getAllByText("Auto")).toHaveLength(2);
    await utils.user.click(screen.getByRole("combobox", { name: "Map Unknown" }));
    await utils.user.click(await screen.findByRole("option", { name: "Notes" }));
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Map Unknown" })).toHaveTextContent("Notes"));
    expect(screen.getAllByText("Auto")).toHaveLength(2);
  });

  it("Back returns to the upload step keeping the file", async () => {
    const utils = setup();
    await uploadAndGoToMap(utils);
    await utils.user.click(screen.getByRole("button", { name: "Back" }));
    expect(await screen.findByText("leads.csv")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Choose another file" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Back" })).not.toBeInTheDocument();
  });

  it("the dialog is named by its title and the close button is labelled", () => {
    setup();
    expect(screen.getByRole("dialog", { name: "Import data" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close import" })).toBeInTheDocument();
  });
});
