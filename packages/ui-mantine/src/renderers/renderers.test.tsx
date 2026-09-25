import { describe, expect, it } from "vitest";
import { createDefaultRegistry } from "../internal/core-contracts";
import { FIXTURE_IDS, FIXTURE_USERS, fixtureColumn } from "../test/fixtures";
import { renderWithMantine } from "../test/render";
import { FormattedRenderer, createFormattedRenderer } from "./FormattedRenderer";
import { FormulaRenderer } from "./FormulaRenderer";
import { MultiSelectRenderer, type MultiSelectRendererConfig } from "./MultiSelectRenderer";
import { SelectRenderer, type SelectRendererConfig } from "./SelectRenderer";
import { UrlRenderer } from "./UrlRenderer";
import { UserRenderer } from "./UserRenderer";

describe("SelectRenderer", () => {
  it("renders a Paid badge with the green colour variable", () => {
    const column = fixtureColumn(FIXTURE_IDS.payment);
    const { getByText } = renderWithMantine(
      <SelectRenderer value="paid" column={column} config={column.config as SelectRendererConfig} fieldType="select" />,
    );
    const badge = getByText("Paid");
    const root = badge.closest(".mantine-Badge-root");
    const style = root?.getAttribute("style") ?? "";
    expect(style).toContain("green");
  });

  it("renders nothing for an empty value", () => {
    const column = fixtureColumn(FIXTURE_IDS.payment);
    const { queryByText } = renderWithMantine(<SelectRenderer value={null} column={column} config={column.config as SelectRendererConfig} fieldType="select" />);
    expect(queryByText("Paid")).not.toBeInTheDocument();
  });
});

describe("MultiSelectRenderer", () => {
  it("shows +2 when there are 5 values and the limit is 3", () => {
    const column = fixtureColumn(FIXTURE_IDS.payment);
    const values = ["paid", "pending", "failed", "paid", "pending"];
    const { getByText } = renderWithMantine(
      <MultiSelectRenderer value={values} column={column} config={column.config as MultiSelectRendererConfig} fieldType="multiSelect" limit={3} />,
    );
    expect(getByText("+2")).toBeInTheDocument();
  });
});

describe("UserRenderer", () => {
  it("shows initials when there is no avatar image", () => {
    const noAvatarUser = FIXTURE_USERS[1];
    if (!noAvatarUser) throw new Error("expected a user fixture without an avatar");
    const column = fixtureColumn(FIXTURE_IDS.owner);
    const { getByText } = renderWithMantine(
      <UserRenderer
        value={{ id: noAvatarUser.id, name: noAvatarUser.label }}
        column={column}
        config={column.config}
        fieldType="user"
      />,
    );
    expect(getByText("VS")).toBeInTheDocument();
    expect(getByText(noAvatarUser.label)).toBeInTheDocument();
  });
});

describe("UrlRenderer", () => {
  it("renders javascript: URLs as plain text, not a link", () => {
    const column = fixtureColumn(FIXTURE_IDS.website);
    const { queryByRole, getByText } = renderWithMantine(
      <UrlRenderer value="javascript:alert(1)" column={column} config={column.config} fieldType="url" />,
    );
    expect(queryByRole("link")).not.toBeInTheDocument();
    expect(getByText("javascript:alert(1)")).toBeInTheDocument();
  });

  it("renders http(s) URLs as a link opened in a new tab", () => {
    const column = fixtureColumn(FIXTURE_IDS.website);
    const { getByRole } = renderWithMantine(
      <UrlRenderer value="https://example.com" column={column} config={column.config} fieldType="url" />,
    );
    const link = getByRole("link");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });
});

describe("FormattedRenderer", () => {
  it("text equals the core format output for currency", () => {
    const column = fixtureColumn(FIXTURE_IDS.amount);
    const registry = createDefaultRegistry();
    const expected = registry.get("currency")?.format(123456, column.config) ?? "";
    const { getByText } = renderWithMantine(<FormattedRenderer value={123456} column={column} config={column.config} fieldType="currency" />);
    expect(getByText(expected)).toBeInTheDocument();
  });

  it("createFormattedRenderer builds a renderer from a caller-supplied registry", () => {
    const registry = createDefaultRegistry();
    const Renderer = createFormattedRenderer(registry);
    const column = fixtureColumn(FIXTURE_IDS.amount);
    const { getByText } = renderWithMantine(<Renderer value={123456} column={column} config={column.config} fieldType="currency" />);
    expect(getByText(registry.get("currency")?.format(123456, column.config) ?? "")).toBeInTheDocument();
  });
});

describe("FormulaRenderer", () => {
  it("never renders an input", () => {
    const column = fixtureColumn(FIXTURE_IDS.total);
    const { container } = renderWithMantine(<FormulaRenderer value={42} column={column} config={column.config} fieldType="formula" />);
    expect(container.querySelector("input")).not.toBeInTheDocument();
  });

  it("shows a muted error marker with the message as its title for a formula error", () => {
    const column = fixtureColumn(FIXTURE_IDS.total);
    const { getByTitle } = renderWithMantine(
      <FormulaRenderer value={{ kind: "formulaError", code: "unknownColumn", message: "Unknown column" }} column={column} config={column.config} fieldType="formula" />,
    );
    expect(getByTitle("Unknown column")).toBeInTheDocument();
  });

  it("formats a plain number result", () => {
    const column = fixtureColumn(FIXTURE_IDS.total);
    const { getByText } = renderWithMantine(<FormulaRenderer value={84} column={column} config={column.config} fieldType="formula" />);
    expect(getByText("84")).toBeInTheDocument();
  });

  it("formats through config.resultType (boolean result → core boolean format)", () => {
    const column = { ...fixtureColumn(FIXTURE_IDS.total), config: { resultType: "boolean" } };
    const expected = createDefaultRegistry().get("boolean")?.format(true, {}) ?? "";
    expect(expected).not.toBe("");
    const { getByText } = renderWithMantine(<FormulaRenderer value={true} column={column} config={column.config} fieldType="formula" />);
    expect(getByText(expected)).toBeInTheDocument();
  });
});

describe("MultiSelectRenderer clamping", () => {
  it("defaults to two pills plus a +N badge on one line", () => {
    const column = fixtureColumn(FIXTURE_IDS.payment);
    const { getByTestId, getByLabelText } = renderWithMantine(
      <MultiSelectRenderer value={["paid", "pending", "failed", "paid"]} column={column} config={column.config as MultiSelectRendererConfig} fieldType="multiSelect" />,
    );
    const cellRoot = getByTestId("multi-select-cell");
    // Visible pills are direct children (the measuring copy is aria-hidden).
    const visible = Array.from(cellRoot.children).filter((c) => c.getAttribute("aria-hidden") !== "true" && c.classList.contains("mantine-Badge-root"));
    expect(visible.map((c) => c.textContent)).toEqual(["Paid", "Pending", "+2"]);
    expect(getByLabelText("2 more")).toBeInTheDocument();
  });

  it("fitPillCount keeps what fits and reserves room for +N", async () => {
    const { fitPillCount } = await import("./MultiSelectRenderer");
    expect(fitPillCount([50, 50, 50], 140, 5)).toBe(2);
    expect(fitPillCount([50, 50, 50], 300, 5)).toBe(3);
    expect(fitPillCount([300], 100, 5)).toBe(1);
    expect(fitPillCount([20, 20, 20, 20], 1000, 2)).toBe(2);
  });
});

describe("BooleanRenderer", () => {
  it("draws a small checkbox, checked for true, muted when read-only", async () => {
    const { BooleanRenderer } = await import("./BooleanRenderer");
    const column = fixtureColumn(FIXTURE_IDS.payment);
    const { getByRole, getByTestId, rerender } = renderWithMantine(<BooleanRenderer value={true} column={column} config={{}} fieldType="boolean" />);
    expect(getByRole("checkbox")).toBeChecked();
    expect(getByRole("checkbox")).toHaveAttribute("tabindex", "-1");
    rerender(<BooleanRenderer value={false} column={column} config={{}} fieldType="boolean" readOnly />);
    expect(getByRole("checkbox")).not.toBeChecked();
    expect(getByTestId("boolean-cell")).toHaveAttribute("data-readonly", "true");
  });
});

describe("FormulaRenderer chrome", () => {
  it("adds a hidden ƒ glyph (CSS, not text) so the cell text stays the value", () => {
    const column = fixtureColumn(FIXTURE_IDS.total);
    const { getByTestId } = renderWithMantine(<FormulaRenderer value={84} column={column} config={column.config} fieldType="formula" />);
    const glyph = getByTestId("formula-glyph");
    expect(glyph).toHaveAttribute("aria-hidden", "true");
    expect(glyph.textContent).toBe("");
    expect(glyph.parentElement?.textContent).toBe("84");
  });
});
