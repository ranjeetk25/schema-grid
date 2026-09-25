import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createDefaultRegistry } from "../internal/core-contracts";
import { FIXTURE_IDS, FIXTURE_USERS, fixtureColumn } from "../test/fixtures";
import { renderUi } from "../test/render";
import { BooleanRenderer } from "./BooleanRenderer";
import { FormattedRenderer, createFormattedRenderer } from "./FormattedRenderer";
import { FormulaRenderer } from "./FormulaRenderer";
import { MultiSelectRenderer, type MultiSelectRendererConfig } from "./MultiSelectRenderer";
import { OptionBadge } from "./OptionBadge";
import { SelectRenderer, type SelectRendererConfig } from "./SelectRenderer";
import { UrlRenderer } from "./UrlRenderer";
import { UserRenderer } from "./UserRenderer";

describe("SelectRenderer", () => {
  it("renders a Paid badge with the green colour variable", () => {
    const column = fixtureColumn(FIXTURE_IDS.payment);
    const { getByText } = renderUi(<SelectRenderer value="paid" column={column} config={column.config as SelectRendererConfig} fieldType="select" />);
    const root = getByText("Paid").closest('[data-slot="badge"]');
    expect(root?.getAttribute("style") ?? "").toContain("green");
  });

  it("renders nothing for an empty value", () => {
    const column = fixtureColumn(FIXTURE_IDS.payment);
    const { queryByText } = renderUi(<SelectRenderer value={null} column={column} config={column.config as SelectRendererConfig} fieldType="select" />);
    expect(queryByText("Paid")).not.toBeInTheDocument();
  });
});

describe("OptionBadge", () => {
  it("renders nothing for an unknown option and an optional 8px dot", () => {
    const { container, rerender } = renderUi(<OptionBadge option={undefined} />);
    expect(container.textContent).toBe("");
    rerender(<OptionBadge option={{ id: "a", label: "A", color: "blue" }} dot />);
    expect(screen.getByTestId("option-color-dot").className).toContain("sg:size-2");
  });
});

describe("MultiSelectRenderer", () => {
  it("shows +2 when there are 5 values and the limit is 3", () => {
    const column = fixtureColumn(FIXTURE_IDS.payment);
    const values = ["paid", "pending", "failed", "paid", "pending"];
    const { getByText } = renderUi(
      <MultiSelectRenderer value={values} column={column} config={column.config as MultiSelectRendererConfig} fieldType="multiSelect" limit={3} />,
    );
    expect(getByText("+2")).toBeInTheDocument();
  });

  it("clamps to one row: no wrapping, overflow hidden", () => {
    const column = fixtureColumn(FIXTURE_IDS.payment);
    const { container } = renderUi(
      <MultiSelectRenderer value={["paid", "pending"]} column={column} config={column.config as MultiSelectRendererConfig} fieldType="multiSelect" />,
    );
    const row = container.querySelector('[data-slot="multi-select-renderer"]') as HTMLElement;
    expect(row.className).toContain("sg:overflow-hidden");
    expect(row.className).toContain("sg:whitespace-nowrap");
    expect(row.className).not.toContain("sg:flex-wrap");
  });
});

describe("UserRenderer", () => {
  it("shows initials when there is no avatar image", async () => {
    const noAvatarUser = FIXTURE_USERS[1];
    if (!noAvatarUser) throw new Error("expected a user fixture without an avatar");
    const column = fixtureColumn(FIXTURE_IDS.owner);
    renderUi(<UserRenderer value={{ id: noAvatarUser.id, name: noAvatarUser.label }} column={column} config={column.config} fieldType="user" />);
    expect(await screen.findByText("VS")).toBeInTheDocument();
    expect(screen.getByText(noAvatarUser.label)).toBeInTheDocument();
  });
});

describe("UrlRenderer", () => {
  it("renders javascript: URLs as plain text, not a link", () => {
    const column = fixtureColumn(FIXTURE_IDS.website);
    const { queryByRole, getByText } = renderUi(<UrlRenderer value="javascript:alert(1)" column={column} config={column.config} fieldType="url" />);
    expect(queryByRole("link")).not.toBeInTheDocument();
    expect(getByText("javascript:alert(1)")).toBeInTheDocument();
  });

  it("renders http(s) URLs as a link opened in a new tab", () => {
    const column = fixtureColumn(FIXTURE_IDS.website);
    const { getByRole } = renderUi(<UrlRenderer value="https://example.com" column={column} config={column.config} fieldType="url" />);
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
    const { getByText } = renderUi(<FormattedRenderer value={123456} column={column} config={column.config} fieldType="currency" />);
    expect(getByText(expected)).toBeInTheDocument();
  });

  it("right-aligns numbers and currency with tabular numerals, left-aligns text", () => {
    const column = fixtureColumn(FIXTURE_IDS.amount);
    const { getByText, rerender } = renderUi(<FormattedRenderer value={42} column={column} config={{}} fieldType="number" />);
    expect(getByText("42").className).toContain("sg:text-right");
    expect(getByText("42").className).toContain("sg:tabular-nums");
    rerender(<FormattedRenderer value="hello" column={column} config={{}} fieldType="text" />);
    expect(getByText("hello").className).not.toContain("sg:text-right");
  });

  it("createFormattedRenderer builds a renderer from a caller-supplied registry", () => {
    const registry = createDefaultRegistry();
    const Renderer = createFormattedRenderer(registry);
    const column = fixtureColumn(FIXTURE_IDS.amount);
    const { getByText } = renderUi(<Renderer value={123456} column={column} config={column.config} fieldType="currency" />);
    expect(getByText(registry.get("currency")?.format(123456, column.config) ?? "")).toBeInTheDocument();
  });
});

describe("BooleanRenderer", () => {
  it("draws a read-only 16px checkbox visual, never true/false text", () => {
    const column = fixtureColumn(FIXTURE_IDS.amount);
    const { getByRole, container, rerender } = renderUi(<BooleanRenderer value={true} column={column} config={{}} fieldType="boolean" />);
    const box = getByRole("checkbox");
    expect(box).toHaveAttribute("aria-checked", "true");
    expect(box).toHaveAttribute("aria-readonly", "true");
    expect(box.className).toContain("sg:size-4");
    expect(container.textContent).not.toMatch(/true|false/i);
    rerender(<BooleanRenderer value={null} column={column} config={{}} fieldType="boolean" />);
    expect(getByRole("checkbox")).toHaveAttribute("aria-checked", "false");
  });
});

describe("FormulaRenderer", () => {
  it("never renders an input", () => {
    const column = fixtureColumn(FIXTURE_IDS.total);
    const { container } = renderUi(<FormulaRenderer value={42} column={column} config={column.config} fieldType="formula" />);
    expect(container.querySelector("input")).not.toBeInTheDocument();
  });

  it("shows a muted error marker with the message as its title for a formula error", () => {
    const column = fixtureColumn(FIXTURE_IDS.total);
    const { getByTitle } = renderUi(
      <FormulaRenderer value={{ kind: "formulaError", code: "unknownColumn", message: "Unknown column" }} column={column} config={column.config} fieldType="formula" />,
    );
    expect(getByTitle("Unknown column")).toHaveTextContent("#ERROR");
  });

  it("formats a plain number result", () => {
    const column = fixtureColumn(FIXTURE_IDS.total);
    const { getByText } = renderUi(<FormulaRenderer value={84} column={column} config={column.config} fieldType="formula" />);
    expect(getByText("84")).toBeInTheDocument();
  });

  it("formats through config.resultType (boolean result → core boolean format)", () => {
    const column = { ...fixtureColumn(FIXTURE_IDS.total), config: { resultType: "boolean" } };
    const expected = createDefaultRegistry().get("boolean")?.format(true, {}) ?? "";
    expect(expected).not.toBe("");
    const { getByText } = renderUi(<FormulaRenderer value={true} column={column} config={column.config} fieldType="formula" />);
    expect(getByText(expected)).toBeInTheDocument();
  });

  it("prefixes a muted ƒ glyph and explains the expression in a tooltip", async () => {
    const column = { ...fixtureColumn(FIXTURE_IDS.total), formula: "{fee} - {paid}" };
    const { user, getByText } = renderUi(<FormulaRenderer value={84} column={column} config={column.config} fieldType="formula" />);
    const glyph = getByText("ƒ");
    expect(glyph).toHaveAttribute("aria-hidden", "true");
    expect(glyph.className).toContain("sg:text-faint-foreground");
    await user.hover(getByText("84"));
    expect((await screen.findAllByText("Formula · {fee} - {paid}")).length).toBeGreaterThan(0);
  });

  it("read-only content never shows a pointer cursor", () => {
    const column = fixtureColumn(FIXTURE_IDS.total);
    const { container } = renderUi(<FormulaRenderer value={84} column={column} config={column.config} fieldType="formula" />);
    expect((container.firstElementChild as HTMLElement).className).toContain("sg:cursor-default");
  });
});
