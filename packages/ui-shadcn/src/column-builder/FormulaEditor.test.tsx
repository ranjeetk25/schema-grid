import { screen, within } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import type { GridRow } from "../internal/core-contracts";
import { buildFixtureAccess, buildFixtureSchema } from "../test/fixtures";
import { renderUi } from "../test/render";
import { FormulaEditor, checkFormula } from "./FormulaEditor";

const schema = buildFixtureSchema();
const access = buildFixtureAccess(schema);

const row = (id: string, cells: Record<string, unknown>): GridRow => ({ id, version: 1, updatedAt: "2026-01-01T00:00:00.000Z", cells });
const SAMPLE_ROWS = [row("r1", { amount: 100 }), row("r2", { amount: 2500 }), row("r3", { amount: null }), row("r4", { amount: 7 })];

function Harness({
  initial = "",
  selfKey,
  onValidityChange,
  sampleRows,
}: {
  initial?: string;
  selfKey?: string;
  onValidityChange?: (v: boolean) => void;
  sampleRows?: GridRow[];
}) {
  const [value, setValue] = useState(initial);
  return (
    <FormulaEditor
      schema={schema}
      access={access}
      value={value}
      onChange={setValue}
      selfKey={selfKey}
      onValidityChange={onValidityChange}
      sampleRows={sampleRows}
    />
  );
}

const textarea = () => screen.getByRole("textbox", { name: /Formula/ }) as HTMLTextAreaElement;

describe("FormulaEditor", () => {
  it("autocompletes {column} refs and places the caret after the token", async () => {
    const { user } = renderUi(<Harness />);
    await user.type(textarea(), "{{am");
    const option = await screen.findByRole("option", { name: /amount/ });
    expect(screen.queryByRole("option", { name: /notes/ })).not.toBeInTheDocument();
    await user.click(option);
    expect(textarea().value).toBe("{amount}");
    expect(textarea().selectionStart).toBe("{amount}".length);
  });

  it("accepts an autocomplete option with the keyboard", async () => {
    const { user } = renderUi(<Harness />);
    await user.type(textarea(), "{{no");
    await user.keyboard("{Enter}");
    expect(textarea().value).toBe("{notes}");
  });

  it("never offers hidden columns or itself", async () => {
    const { user } = renderUi(<Harness selfKey="total" />);
    await user.type(textarea(), "{{");
    expect(await screen.findByRole("option", { name: /amount/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /secret/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /total/i })).not.toBeInTheDocument();
  });

  it("shows the inferred result type", () => {
    const { unmount } = renderUi(<Harness initial="{amount} * 2" />);
    expect(screen.getByLabelText("Result type")).toHaveTextContent("number");
    unmount();
    renderUi(<Harness initial={'CONCAT({notes}, "x")'} />);
    expect(screen.getByLabelText("Result type")).toHaveTextContent("text");
  });

  it("shows parse errors with position and reports validity", () => {
    const onValidityChange = vi.fn();
    renderUi(<Harness initial="{amount} *" onValidityChange={onValidityChange} />);
    expect(screen.getByText(/Unexpected end of formula/)).toBeInTheDocument();
    expect(screen.getByText(/position 10/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Result type")).not.toBeInTheDocument();
    expect(onValidityChange).toHaveBeenLastCalledWith(false);
  });

  it("does not nag on first paint of an empty formula, only once the user types", async () => {
    const { user } = renderUi(<Harness />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await user.type(textarea(), "1 +");
    expect(screen.getByRole("alert")).toHaveTextContent(/Unexpected end of formula/);
  });

  it("rejects self references and unknown or hidden columns", () => {
    const { unmount } = renderUi(<Harness initial="{total} + 1" selfKey="total" />);
    expect(screen.getByText(/cannot reference itself/)).toBeInTheDocument();
    unmount();
    const r2 = renderUi(<Harness initial="{nope} + 1" />);
    expect(screen.getByText(/Unknown column "nope"/)).toBeInTheDocument();
    r2.unmount();
    renderUi(<Harness initial="{secret}" />);
    expect(screen.getByText(/Unknown column "secret"/)).toBeInTheDocument();
  });

  it("reports valid formulas", () => {
    const onValidityChange = vi.fn();
    renderUi(<Harness initial="{amount} * 2" onValidityChange={onValidityChange} />);
    expect(onValidityChange).toHaveBeenLastCalledWith(true);
  });

  it("column chips insert {key} at the caret, readable columns only", async () => {
    const { user } = renderUi(<Harness selfKey="total" />);
    const chips = screen.getByRole("group", { name: "Columns" });
    expect(within(chips).queryByRole("button", { name: /Secret/ })).not.toBeInTheDocument();
    expect(within(chips).queryByRole("button", { name: /Total/ })).not.toBeInTheDocument();
    await user.type(textarea(), "SUM(, 1)");
    textarea().setSelectionRange(4, 4);
    await user.click(within(chips).getByRole("button", { name: "Insert Amount" }));
    expect(textarea().value).toBe("SUM({amount}, 1)");
  });

  it("inserts a preset example in one click", async () => {
    const { user } = renderUi(<Harness />);
    await user.click(screen.getByRole("button", { name: "Use example {amount} * 1.18" }));
    expect(textarea().value).toBe("{amount} * 1.18");
    expect(screen.getByLabelText("Result type")).toHaveTextContent("number");
  });

  it("the Functions popover searches and inserts NAME() with the caret inside", async () => {
    const { user } = renderUi(<Harness />);
    await user.click(screen.getByRole("button", { name: "Functions" }));
    await user.type(screen.getByPlaceholderText("Search functions…"), "round");
    await user.click(await screen.findByRole("option", { name: /ROUND/ }));
    expect(textarea().value).toBe("ROUND()");
    expect(textarea().selectionStart).toBe("ROUND(".length);
  });

  it("previews the formula on up to 3 sample rows", () => {
    renderUi(<Harness initial="{amount} * 2" sampleRows={SAMPLE_ROWS} />);
    const table = screen.getByRole("table", { name: "Formula preview" });
    const bodyRows = within(table).getAllByRole("row").slice(1);
    expect(bodyRows).toHaveLength(3);
    expect(within(bodyRows[0] as HTMLElement).getAllByRole("cell").at(-1)).toHaveTextContent("200");
    expect(within(bodyRows[1] as HTMLElement).getAllByRole("cell").at(-1)).toHaveTextContent("5,000");
  });

  it("hides the preview without sample rows", () => {
    renderUi(<Harness initial="{amount} * 2" />);
    expect(screen.queryByRole("table", { name: "Formula preview" })).not.toBeInTheDocument();
  });
});

describe("checkFormula", () => {
  it("detects cycles through other formula columns", () => {
    const s = buildFixtureSchema();
    const res = checkFormula("{total} + 1", s, buildFixtureAccess(s), "amount");
    expect(res.valid).toBe(false);
  });
});
