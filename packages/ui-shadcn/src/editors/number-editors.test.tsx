import { describe, expect, it, vi } from "vitest";
import { FIXTURE_IDS, fixtureColumn } from "../test/fixtures";
import { renderUi } from "../test/render";
import { BooleanEditor } from "./BooleanEditor";
import { CurrencyEditor } from "./CurrencyEditor";
import { NumberEditor } from "./NumberEditor";

const base = () => ({
  onChange: vi.fn(),
  onCommit: vi.fn(),
  onCancel: vi.fn(),
  column: fixtureColumn(FIXTURE_IDS.amount),
});

describe("NumberEditor", () => {
  it("emits the typed number", async () => {
    const props = base();
    const { user, getByRole } = renderUi(<NumberEditor {...props} value={null} config={{ precision: 1 }} />);
    await user.type(getByRole("textbox"), "1234.5");
    expect(props.onChange).toHaveBeenLastCalledWith(1234.5);
  });

  it("emits null when cleared", async () => {
    const props = base();
    const { user, getByRole } = renderUi(<NumberEditor {...props} value={5} config={{ precision: 0 }} />);
    await user.clear(getByRole("textbox"));
    expect(props.onChange).toHaveBeenLastCalledWith(null);
  });

  it("is right-aligned with tabular numerals", () => {
    const { getByRole } = renderUi(<NumberEditor {...base()} value={5} config={{}} />);
    expect(getByRole("textbox").className).toContain("sg:text-right");
    expect(getByRole("textbox").className).toContain("sg:tabular-nums");
  });

  it("does not accept more decimals than the precision", async () => {
    const props = base();
    const { user, getByRole } = renderUi(<NumberEditor {...props} value={null} config={{ precision: 1 }} />);
    await user.type(getByRole("textbox"), "1.23");
    expect((getByRole("textbox") as HTMLInputElement).value).toBe("1.2");
    expect(props.onChange).toHaveBeenLastCalledWith(1.2);
  });

  it("commits on Enter and cancels on Escape", async () => {
    const props = base();
    const { user, getByRole } = renderUi(<NumberEditor {...props} value={3} config={{}} />);
    await user.type(getByRole("textbox"), "{Enter}");
    expect(props.onCommit).toHaveBeenCalled();
    await user.keyboard("{Escape}");
    expect(props.onCancel).toHaveBeenCalled();
  });

  it("shows an out-of-range message and blocks the commit", async () => {
    const props = base();
    const gridKeys: string[] = [];
    const { user, getByRole, getByText, container } = renderUi(<NumberEditor {...props} value={null} config={{ max: 10 }} />);
    container.addEventListener("keydown", (e) => gridKeys.push(e.key));
    await user.type(getByRole("textbox"), "12");
    expect(getByText("Must be at most 10")).toBeInTheDocument();
    expect(getByRole("textbox")).toHaveAttribute("aria-invalid", "true");
    await user.keyboard("{Enter}");
    expect(props.onCommit).not.toHaveBeenCalled();
    expect(gridKeys).not.toContain("Enter");
  });
});

describe("CurrencyEditor", () => {
  it("shows the lakh-grouped INR value with a ₹ adornment for an en-IN config", () => {
    const { getByRole, getByText } = renderUi(
      <CurrencyEditor {...base()} value={123456} config={{ currencyCode: "INR", locale: "en-IN", precision: 0 }} />,
    );
    expect((getByRole("textbox") as HTMLInputElement).value).toBe("1,23,456");
    expect(getByText("₹")).toBeInTheDocument();
  });

  it("shows the thousand-grouped USD value with a $ adornment for a USD config", () => {
    const { getByRole, getByText } = renderUi(
      <CurrencyEditor {...base()} value={123456} config={{ currencyCode: "USD", locale: "en-US", precision: 0 }} />,
    );
    expect((getByRole("textbox") as HTMLInputElement).value).toBe("123,456");
    expect(getByText("$")).toBeInTheDocument();
  });

  it("parses grouped input back to a number", async () => {
    const props = base();
    const { user, getByRole } = renderUi(<CurrencyEditor {...props} value={null} config={{ currencyCode: "INR", locale: "en-IN" }} />);
    await user.type(getByRole("textbox"), "1,23,456.5");
    expect(props.onChange).toHaveBeenLastCalledWith(123456.5);
  });

  it("regroups the value on blur", async () => {
    const { user, getByRole } = renderUi(
      <CurrencyEditor {...base()} value={null} config={{ currencyCode: "USD", locale: "en-US", precision: 0 }} autoFocus={false} />,
    );
    const input = getByRole("textbox") as HTMLInputElement;
    await user.type(input, "1234567");
    await user.tab();
    expect(input.value).toBe("1,234,567");
  });
});

describe("BooleanEditor", () => {
  it("toggles and commits on click", async () => {
    const props = base();
    const { user, getByRole } = renderUi(<BooleanEditor {...props} value={false} config={{}} />);
    await user.click(getByRole("checkbox"));
    expect(props.onChange).toHaveBeenCalledWith(true);
    expect(props.onCommit).toHaveBeenCalled();
  });

  it("toggles and commits on space", async () => {
    const props = base();
    const { user, getByRole } = renderUi(<BooleanEditor {...props} value={false} config={{}} autoFocus />);
    getByRole("checkbox").focus();
    await user.keyboard(" ");
    expect(props.onChange).toHaveBeenCalledWith(true);
    expect(props.onCommit).toHaveBeenCalled();
  });

  it("toggleOnMount flips and commits immediately (edit started by Space / click)", () => {
    const props = base();
    renderUi(<BooleanEditor {...props} value={true} config={{}} toggleOnMount />);
    expect(props.onChange).toHaveBeenCalledWith(false);
    expect(props.onCommit).toHaveBeenCalledWith(false);
  });

  it("is a 16px Radix checkbox focused in grid mode", () => {
    const { getByRole } = renderUi(<BooleanEditor {...base()} value={true} config={{}} />);
    const box = getByRole("checkbox");
    expect(box).toHaveFocus();
    expect(box).toHaveAttribute("aria-checked", "true");
    expect(box.className).toContain("sg:size-4");
  });
});
