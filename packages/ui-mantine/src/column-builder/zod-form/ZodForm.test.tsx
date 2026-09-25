import { fireEvent, screen, within } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createDefaultRegistry } from "../../internal/core-contracts";
import { renderWithMantine } from "../../test/render";
import { ZodForm, humanizeKey } from "./ZodForm";
import { slugifyOptionValue } from "./OptionListField";

const selectSchema = () => createDefaultRegistry().get("select")?.configSchema;

/** Controlled harness: feeds each emitted value back in, like a real parent. */
function Harness({ schema, initial = {}, onChange }: { schema: unknown; initial?: Record<string, unknown>; onChange: (v: Record<string, unknown>) => void }) {
  const [value, setValue] = useState<Record<string, unknown>>(initial);
  return (
    <ZodForm
      schema={schema}
      value={value}
      onChange={(next) => {
        setValue(next);
        onChange(next);
      }}
    />
  );
}

const lastCall = (fn: ReturnType<typeof vi.fn>) => fn.mock.calls[fn.mock.calls.length - 1]?.[0];

describe("helpers", () => {
  it("humanises keys", () => {
    expect(humanizeKey("maxLength")).toBe("Max length");
    expect(humanizeKey("allow_multiple")).toBe("Allow multiple");
    expect(humanizeKey("options")).toBe("Options");
  });

  it("slugifies option values", () => {
    expect(slugifyOptionValue("Paid")).toBe("paid");
    expect(slugifyOptionValue("  In Progress! ")).toBe("in_progress");
    expect(slugifyOptionValue("--A/B--")).toBe("a_b");
  });
});

describe("ZodForm", () => {
  it("renders the select configSchema as an option list with an add button", () => {
    renderWithMantine(<ZodForm schema={selectSchema()} value={{}} onChange={vi.fn()} />);
    expect(screen.getByText("Options")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add option" })).toBeInTheDocument();
  });

  it("adding 'Paid' and choosing green emits the option", async () => {
    const onChange = vi.fn();
    const { user } = renderWithMantine(<Harness schema={selectSchema()} onChange={onChange} />);
    await user.click(screen.getByRole("button", { name: "Add option" }));
    await user.type(screen.getByRole("textbox", { name: "Option label" }), "Paid");
    expect(screen.getByRole("textbox", { name: "Option id" })).toHaveValue("paid");
    await user.click(screen.getByRole("button", { name: "Option colour" }));
    await user.click(screen.getByRole("button", { name: "green" }));
    expect(lastCall(onChange)).toStrictEqual({ options: [{ id: "paid", label: "Paid", color: "green" }] });
  });

  it("omits color when none was chosen, and when the schema has no color field", async () => {
    const onChange = vi.fn();
    const { user } = renderWithMantine(<Harness schema={selectSchema()} onChange={onChange} />);
    await user.click(screen.getByRole("button", { name: "Add option" }));
    await user.type(screen.getByRole("textbox", { name: "Option label" }), "Paid");
    expect(lastCall(onChange)).toStrictEqual({ options: [{ id: "paid", label: "Paid" }] });

    const onChange2 = vi.fn();
    const noColor = z.object({ options: z.array(z.object({ label: z.string(), value: z.string() })) });
    const r2 = renderWithMantine(<Harness schema={noColor} onChange={onChange2} />);
    await r2.user.click(within(r2.container).getByRole("button", { name: "Add option" }));
    expect(within(r2.container).queryByRole("button", { name: "Option colour" })).toBeNull();
  });

  it("stops auto-deriving the id once the user edits it", async () => {
    const onChange = vi.fn();
    const { user } = renderWithMantine(<Harness schema={selectSchema()} onChange={onChange} />);
    await user.click(screen.getByRole("button", { name: "Add option" }));
    const label = screen.getByRole("textbox", { name: "Option label" });
    const value = screen.getByRole("textbox", { name: "Option id" });
    await user.type(label, "Paid");
    await user.clear(value);
    await user.type(value, "p1");
    await user.type(label, " up");
    expect(value).toHaveValue("p1");
    expect(lastCall(onChange)).toStrictEqual({ options: [{ id: "p1", label: "Paid up" }] });
  });

  it("does not rewrite ids of existing options when their label changes", async () => {
    const onChange = vi.fn();
    const { user } = renderWithMantine(
      <Harness schema={selectSchema()} initial={{ options: [{ id: "paid_v1", label: "Paid", color: "green" }] }} onChange={onChange} />,
    );
    await user.type(screen.getByRole("textbox", { name: "Option label" }), "!");
    expect(lastCall(onChange)).toStrictEqual({ options: [{ id: "paid_v1", label: "Paid!", color: "green" }] });
  });

  it("reorders and removes options", async () => {
    const onChange = vi.fn();
    const initial = {
      options: [
        { id: "a", label: "A" },
        { id: "b", label: "B" },
        { id: "c", label: "C" },
      ],
    };
    const { user } = renderWithMantine(<Harness schema={selectSchema()} initial={initial} onChange={onChange} />);
    const ups = screen.getAllByRole("button", { name: "Move option up" });
    expect(ups[0]).toBeDisabled();
    await user.click(ups[1] as HTMLElement);
    expect((lastCall(onChange) as { options: { id: string }[] }).options.map((o) => o.id)).toEqual(["b", "a", "c"]);
    const downs = screen.getAllByRole("button", { name: "Move option down" });
    expect(downs[2]).toBeDisabled();
    await user.click(downs[1] as HTMLElement);
    expect((lastCall(onChange) as { options: { id: string }[] }).options.map((o) => o.id)).toEqual(["b", "c", "a"]);
    await user.click(screen.getAllByRole("button", { name: "Remove option" })[0] as HTMLElement);
    expect((lastCall(onChange) as { options: { id: string }[] }).options.map((o) => o.id)).toEqual(["c", "a"]);
  });

  it("renders a boolean as a switch", async () => {
    const onChange = vi.fn();
    const { user } = renderWithMantine(<ZodForm schema={z.object({ allowMultiple: z.boolean() })} value={{}} onChange={onChange} />);
    const sw = screen.getByRole("switch", { name: /Allow multiple/ });
    await user.click(sw);
    expect(lastCall(onChange)).toEqual({ allowMultiple: true });
  });

  it("renders strings, numbers and enums; marks optional fields", async () => {
    const onChange = vi.fn();
    const schema = z.object({
      title: z.string(),
      maxLength: z.number().int().optional(),
      size: z.enum(["small", "large"]),
    });
    const { user } = renderWithMantine(<Harness schema={schema} onChange={onChange} />);
    expect(screen.getByRole("textbox", { name: "Title" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: /Max length \(optional\)/ })).toBeInTheDocument();
    await user.type(screen.getByRole("textbox", { name: "Title" }), "Hi");
    expect(lastCall(onChange)).toEqual({ title: "Hi" });
    await user.type(screen.getByRole("textbox", { name: /Max length/ }), "12");
    expect(lastCall(onChange)).toEqual({ title: "Hi", maxLength: 12 });
    await user.click(screen.getByRole("textbox", { name: "Size" }));
    await user.click(screen.getByRole("option", { name: "large" }));
    expect(lastCall(onChange)).toEqual({ title: "Hi", maxLength: 12, size: "large" });
  });

  it("pre-fills defaults and emits them on first change", async () => {
    const onChange = vi.fn();
    const schema = z.object({ prefix: z.string().default("#"), decimals: z.number().default(2), label: z.string() });
    const { user } = renderWithMantine(<Harness schema={schema} onChange={onChange} />);
    expect(screen.getByRole("textbox", { name: "Prefix" })).toHaveValue("#");
    expect(screen.getByRole("textbox", { name: "Decimals" })).toHaveValue("2");
    await user.type(screen.getByRole("textbox", { name: "Label" }), "x");
    expect(lastCall(onChange)).toEqual({ prefix: "#", decimals: 2, label: "x" });
  });

  it("renders nested objects in a fieldset", async () => {
    const onChange = vi.fn();
    const schema = z.object({ display: z.object({ showIcon: z.boolean().default(true) }) });
    const { user } = renderWithMantine(<Harness schema={schema} onChange={onChange} />);
    expect(screen.getByRole("group", { name: "Display" })).toBeInTheDocument();
    const sw = screen.getByRole("switch", { name: "Show icon" });
    expect(sw).toBeChecked();
    await user.click(sw);
    expect(lastCall(onChange)).toEqual({ display: { showIcon: false } });
  });

  it("shows errors by dot path", () => {
    renderWithMantine(
      <ZodForm
        schema={z.object({ title: z.string(), display: z.object({ size: z.number() }) })}
        value={{}}
        onChange={vi.fn()}
        errors={{ title: "Title is required", "display.size": "Too big" }}
      />,
    );
    expect(screen.getByText("Title is required")).toBeInTheDocument();
    expect(screen.getByText("Too big")).toBeInTheDocument();
  });

  it("renders an unsupported union as JSON; invalid JSON shows an error and does not emit", async () => {
    const onChange = vi.fn();
    const schema = z.object({ mixed: z.union([z.string(), z.number()]) });
    renderWithMantine(<ZodForm schema={schema} value={{ mixed: 1 }} onChange={onChange} />);
    const textarea = screen.getByRole("textbox", { name: "Mixed" });
    expect(textarea.tagName).toBe("TEXTAREA");
    expect(textarea).toHaveValue("1");
    fireEvent.change(textarea, { target: { value: "{ nope" } });
    expect(screen.getByText("Invalid JSON")).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.change(textarea, { target: { value: '"hello"' } });
    expect(screen.queryByText("Invalid JSON")).toBeNull();
    expect(lastCall(onChange)).toEqual({ mixed: "hello" });
  });

  it("keeps the colour popover inside the form (withinPortal false)", async () => {
    const { user, container } = renderWithMantine(<Harness schema={selectSchema()} onChange={vi.fn()} />, { env: "default" });
    await user.click(screen.getByRole("button", { name: "Add option" }));
    await user.click(screen.getByRole("button", { name: "Option colour" }));
    const swatch = await screen.findByRole("button", { name: "green" });
    expect(container.contains(swatch)).toBe(true);
  });
});
