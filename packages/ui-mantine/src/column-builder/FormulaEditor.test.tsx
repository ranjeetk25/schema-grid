import { screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { buildFixtureAccess, buildFixtureSchema } from "../test/fixtures";
import { renderWithMantine } from "../test/render";
import { FormulaEditor } from "./FormulaEditor";

const schema = buildFixtureSchema();
const access = buildFixtureAccess(schema);

function Harness({ initial = "", selfKey, onValidityChange }: { initial?: string; selfKey?: string; onValidityChange?: (v: boolean) => void }) {
  const [value, setValue] = useState(initial);
  return (
    <FormulaEditor
      schema={schema}
      access={access}
      value={value}
      onChange={setValue}
      selfKey={selfKey}
      onValidityChange={onValidityChange}
    />
  );
}

const textarea = () => screen.getByRole("textbox", { name: /Formula/ }) as HTMLTextAreaElement;

describe("FormulaEditor", () => {
  it("autocompletes {column} refs and places the caret after the token", async () => {
    const { user } = renderWithMantine(<Harness />);
    await user.type(textarea(), "{{am");
    const option = await screen.findByRole("option", { name: /amount/ });
    expect(screen.queryByRole("option", { name: /notes/ })).not.toBeInTheDocument();
    await user.click(option);
    expect(textarea().value).toBe("{amount}");
    expect(textarea().selectionStart).toBe("{amount}".length);
  });

  it("never offers hidden columns or itself", async () => {
    const { user } = renderWithMantine(<Harness selfKey="total" />);
    await user.type(textarea(), "{{");
    expect(await screen.findByRole("option", { name: /amount/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /secret/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /total/i })).not.toBeInTheDocument();
  });

  it("shows the inferred result type", () => {
    const { unmount } = renderWithMantine(<Harness initial="{amount} * 2" />);
    expect(screen.getByLabelText("Result type")).toHaveTextContent("number");
    unmount();
    renderWithMantine(<Harness initial={'CONCAT({notes}, "x")'} />);
    expect(screen.getByLabelText("Result type")).toHaveTextContent("text");
  });

  it("shows parse errors with position and reports validity", () => {
    const onValidityChange = vi.fn();
    renderWithMantine(<Harness initial="{amount} *" onValidityChange={onValidityChange} />);
    expect(screen.getByText(/Unexpected end of formula/)).toBeInTheDocument();
    expect(screen.getByText(/position 10/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Result type")).not.toBeInTheDocument();
    expect(onValidityChange).toHaveBeenLastCalledWith(false);
  });

  it("rejects self references and unknown or hidden columns", () => {
    const { unmount } = renderWithMantine(<Harness initial="{total} + 1" selfKey="total" />);
    expect(screen.getByText(/cannot reference itself/)).toBeInTheDocument();
    unmount();
    const r2 = renderWithMantine(<Harness initial="{nope} + 1" />);
    expect(screen.getByText(/Unknown column "nope"/)).toBeInTheDocument();
    r2.unmount();
    renderWithMantine(<Harness initial="{secret}" />);
    expect(screen.getByText(/Unknown column "secret"/)).toBeInTheDocument();
  });

  it("reports valid formulas", () => {
    const onValidityChange = vi.fn();
    renderWithMantine(<Harness initial="{amount} * 2" onValidityChange={onValidityChange} />);
    expect(onValidityChange).toHaveBeenLastCalledWith(true);
  });
});
