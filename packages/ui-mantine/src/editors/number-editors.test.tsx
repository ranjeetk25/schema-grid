import { describe, expect, it, vi } from "vitest";
import { fixtureColumn, FIXTURE_IDS } from "../test/fixtures";
import { renderWithMantine } from "../test/render";
import { BooleanEditor } from "./BooleanEditor";
import { CurrencyEditor } from "./CurrencyEditor";
import { NumberEditor } from "./NumberEditor";

describe("NumberEditor", () => {
  it("emits the typed number", async () => {
    const onChange = vi.fn();
    const { user, getByRole } = renderWithMantine(
      <NumberEditor
        value={null}
        onChange={onChange}
        onCommit={vi.fn()}
        onCancel={vi.fn()}
        column={fixtureColumn(FIXTURE_IDS.amount)}
        config={{ precision: 1 }}
      />,
    );
    const input = getByRole("textbox");
    await user.type(input, "1234.5");
    expect(onChange).toHaveBeenLastCalledWith(1234.5);
  });

  it("emits null when cleared", async () => {
    const onChange = vi.fn();
    const { user, getByRole } = renderWithMantine(
      <NumberEditor
        value={5}
        onChange={onChange}
        onCommit={vi.fn()}
        onCancel={vi.fn()}
        column={fixtureColumn(FIXTURE_IDS.amount)}
        config={{ precision: 0 }}
      />,
    );
    const input = getByRole("textbox");
    await user.clear(input);
    expect(onChange).toHaveBeenLastCalledWith(null);
  });
});

describe("CurrencyEditor", () => {
  it("shows the lakh-grouped INR prefix for an en-IN config", () => {
    const { getByRole } = renderWithMantine(
      <CurrencyEditor
        value={123456}
        onChange={vi.fn()}
        onCommit={vi.fn()}
        onCancel={vi.fn()}
        column={fixtureColumn(FIXTURE_IDS.amount)}
        config={{ currency: "INR", locale: "en-IN", decimalScale: 0, fixedDecimalScale: false }}
      />,
    );
    const input = getByRole("textbox") as HTMLInputElement;
    expect(input.value).toBe("₹1,23,456");
  });

  it("shows the thousand-grouped USD prefix for a USD config", () => {
    const { getByRole } = renderWithMantine(
      <CurrencyEditor
        value={123456}
        onChange={vi.fn()}
        onCommit={vi.fn()}
        onCancel={vi.fn()}
        column={fixtureColumn(FIXTURE_IDS.amount)}
        config={{ currency: "USD", locale: "en-US", decimalScale: 0, fixedDecimalScale: false }}
      />,
    );
    const input = getByRole("textbox") as HTMLInputElement;
    expect(input.value).toBe("$123,456");
  });
});

describe("BooleanEditor", () => {
  it("toggles and commits on click", async () => {
    const onChange = vi.fn();
    const onCommit = vi.fn();
    const { user, getByRole } = renderWithMantine(
      <BooleanEditor
        value={false}
        onChange={onChange}
        onCommit={onCommit}
        onCancel={vi.fn()}
        column={fixtureColumn(FIXTURE_IDS.amount)}
        config={{}}
      />,
    );
    await user.click(getByRole("checkbox"));
    expect(onChange).toHaveBeenCalledWith(true);
    expect(onCommit).toHaveBeenCalled();
  });

  it("toggles and commits on space", async () => {
    const onChange = vi.fn();
    const onCommit = vi.fn();
    const { user, getByRole } = renderWithMantine(
      <BooleanEditor
        value={false}
        onChange={onChange}
        onCommit={onCommit}
        onCancel={vi.fn()}
        column={fixtureColumn(FIXTURE_IDS.amount)}
        config={{}}
        autoFocus
      />,
    );
    getByRole("checkbox").focus();
    await user.keyboard(" ");
    expect(onChange).toHaveBeenCalledWith(true);
    expect(onCommit).toHaveBeenCalled();
  });
});
