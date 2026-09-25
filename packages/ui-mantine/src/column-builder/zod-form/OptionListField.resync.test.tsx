import { screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { renderWithMantine } from "../../test/render";
import { ZodForm } from "./ZodForm";

const schema = z.object({ options: z.array(z.object({ label: z.string(), value: z.string(), color: z.string().optional() })).default([]) });

function CloningParent({ onValue }: { onValue: (v: Record<string, unknown>) => void }) {
  const [value, setValue] = useState<Record<string, unknown>>({});
  return (
    <ZodForm
      schema={schema}
      value={value}
      onChange={(next) => {
        const cloned = JSON.parse(JSON.stringify(next)) as Record<string, unknown>;
        setValue(cloned);
        onValue(cloned);
      }}
    />
  );
}

describe("OptionListField with a cloning parent", () => {
  it("keeps focus and auto-derives values when the parent echoes an equal copy", async () => {
    let latest: Record<string, unknown> = {};
    const { user } = renderWithMantine(<CloningParent onValue={(v) => (latest = v)} />);
    await user.click(screen.getByRole("button", { name: "Add option" }));
    await user.type(screen.getAllByRole("textbox", { name: "Option label" })[0] as HTMLElement, "In Progress");
    expect(latest).toEqual({ options: [{ label: "In Progress", value: "in_progress" }] });
  });
});
