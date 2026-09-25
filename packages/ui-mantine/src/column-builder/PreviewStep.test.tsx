import { Badge } from "@mantine/core";
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { UiEditorProps, UiRendererProps } from "../internal/grid-contracts";
import { getSelectOptions } from "../internal/options";
import { PAYMENT_OPTIONS, buildFixtureRegistry, buildFixtureSchema, buildStubUiRegistry } from "../test/fixtures";
import { renderWithMantine } from "../test/render";
import { columnDraftReducer, createColumnDraft } from "./model";
import { PreviewStep, sampleValueFor } from "./PreviewStep";

const registry = buildFixtureRegistry();

function BadgeRenderer({ value, config }: UiRendererProps<string>) {
  const opt = getSelectOptions(config).find((o) => o.value === value);
  return opt ? <Badge data-testid="preview-badge">{opt.label}</Badge> : null;
}

function OptionButtonsEditor({ config, onChange }: UiEditorProps<string>) {
  return (
    <div>
      {getSelectOptions(config).map((o) => (
        <button type="button" key={o.value} onClick={() => onChange(o.value)}>
          {`pick ${o.label}`}
        </button>
      ))}
    </div>
  );
}

const uiRegistry = buildStubUiRegistry().extend({ select: { renderer: BadgeRenderer, editor: OptionButtonsEditor } });

const selectDraft = () => {
  let d = createColumnDraft({ schema: buildFixtureSchema(), registry });
  d = columnDraftReducer(d, { type: "setType", fieldType: "select", registry });
  d = columnDraftReducer(d, { type: "setLabel", label: "Status" });
  return columnDraftReducer(d, { type: "setConfig", config: { options: PAYMENT_OPTIONS } });
};

describe("PreviewStep", () => {
  it("renders the sample through the type renderer, and edits update it", async () => {
    const { user } = renderWithMantine(<PreviewStep draft={selectDraft()} registry={registry} uiRegistry={uiRegistry} />);
    expect(screen.getByTestId("preview-badge")).toHaveTextContent("Paid");
    await user.click(screen.getByRole("button", { name: "pick Failed" }));
    expect(screen.getByTestId("preview-badge")).toHaveTextContent("Failed");
  });

  it("picks type-specific samples", () => {
    expect(sampleValueFor("number", {}, registry)).toBe(42);
    expect(sampleValueFor("multiSelect", { options: PAYMENT_OPTIONS }, registry)).toEqual(["paid", "pending"]);
    expect(sampleValueFor("boolean", {}, registry)).toBe(true);
  });
});
