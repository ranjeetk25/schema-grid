import { describe, expect, it, vi } from "vitest";
import { fixtureColumn, FIXTURE_IDS } from "../test/fixtures";
import { renderWithMantine } from "../test/render";
import { EmailEditor, PhoneEditor, UrlEditor } from "./ContactEditors";
import { LongTextEditor, LongTextPopupEditor } from "./LongTextEditor";
import { TextEditor } from "./TextEditor";

describe("TextEditor", () => {
  it("commits the typed string on Enter", async () => {
    const onCommit = vi.fn();
    const onCancel = vi.fn();
    const onChange = vi.fn();
    const { user, getByRole } = renderWithMantine(
      <TextEditor
        value={null}
        onChange={onChange}
        onCommit={onCommit}
        onCancel={onCancel}
        column={fixtureColumn(FIXTURE_IDS.notes)}
        config={{}}
      />,
    );
    const input = getByRole("textbox");
    await user.type(input, "hello{Enter}");
    expect(onCommit).toHaveBeenCalledWith("hello");
  });

  it("cancels on Escape", async () => {
    const onCancel = vi.fn();
    const { user, getByRole } = renderWithMantine(
      <TextEditor
        value={null}
        onChange={vi.fn()}
        onCommit={vi.fn()}
        onCancel={onCancel}
        column={fixtureColumn(FIXTURE_IDS.notes)}
        config={{}}
      />,
    );
    const input = getByRole("textbox");
    await user.type(input, "abc{Escape}");
    expect(onCancel).toHaveBeenCalled();
  });
});

describe("LongTextEditor", () => {
  it("inserts a newline on plain Enter and does not commit", async () => {
    const onCommit = vi.fn();
    const { user, getByRole } = renderWithMantine(
      <LongTextEditor
        value={null}
        onChange={vi.fn()}
        onCommit={onCommit}
        onCancel={vi.fn()}
        column={fixtureColumn(FIXTURE_IDS.notes)}
        config={{}}
      />,
    );
    const textarea = getByRole("textbox") as HTMLTextAreaElement;
    await user.type(textarea, "line1{Enter}line2");
    expect(onCommit).not.toHaveBeenCalled();
    expect(textarea.value).toBe("line1\nline2");
  });

  it("commits on Ctrl+Enter", async () => {
    const onCommit = vi.fn();
    const { user, getByRole } = renderWithMantine(
      <LongTextEditor
        value={null}
        onChange={vi.fn()}
        onCommit={onCommit}
        onCancel={vi.fn()}
        column={fixtureColumn(FIXTURE_IDS.notes)}
        config={{}}
      />,
    );
    const textarea = getByRole("textbox");
    await user.type(textarea, "hi");
    await user.keyboard("{Control>}{Enter}{/Control}");
    expect(onCommit).toHaveBeenCalledWith("hi");
  });

  it("exports LongTextPopupEditor wrapped as a popup editor", () => {
    expect(LongTextPopupEditor.cellEditorPopup).toBe(true);
    expect(LongTextPopupEditor.cellEditorPopupPosition).toBe("under");
  });
});

describe("EmailEditor", () => {
  it("has inputmode email and shows a hint for an invalid address", async () => {
    const { user, getByRole, getByText, queryByText } = renderWithMantine(
      <EmailEditor
        value={null}
        onChange={vi.fn()}
        onCommit={vi.fn()}
        onCancel={vi.fn()}
        column={fixtureColumn(FIXTURE_IDS.notes)}
        config={{}}
      />,
    );
    const input = getByRole("textbox");
    expect(input).toHaveAttribute("inputmode", "email");
    await user.type(input, "abc");
    expect(getByText(/invalid email address/i)).toBeInTheDocument();
    await user.clear(input);
    await user.type(input, "a@b.co");
    expect(queryByText(/invalid email address/i)).not.toBeInTheDocument();
  });
});

describe("PhoneEditor", () => {
  it("has inputmode tel", () => {
    const { getByRole } = renderWithMantine(
      <PhoneEditor
        value={null}
        onChange={vi.fn()}
        onCommit={vi.fn()}
        onCancel={vi.fn()}
        column={fixtureColumn(FIXTURE_IDS.notes)}
        config={{}}
      />,
    );
    expect(getByRole("textbox")).toHaveAttribute("inputmode", "tel");
  });
});

describe("UrlEditor", () => {
  it("has inputmode url", () => {
    const { getByRole } = renderWithMantine(
      <UrlEditor
        value={null}
        onChange={vi.fn()}
        onCommit={vi.fn()}
        onCancel={vi.fn()}
        column={fixtureColumn(FIXTURE_IDS.website)}
        config={{}}
      />,
    );
    expect(getByRole("textbox")).toHaveAttribute("inputmode", "url");
  });
});

describe("inline validation (text-family editors)", () => {
  const base = () => ({ onChange: vi.fn(), onCommit: vi.fn(), onCancel: vi.fn(), column: fixtureColumn(FIXTURE_IDS.notes), config: {} });

  it("shows no error on open, even for an invalid stored value", () => {
    const { queryByText, getByRole } = renderWithMantine(<PhoneEditor {...base()} value="abc" />);
    expect(queryByText(/invalid phone/i)).not.toBeInTheDocument();
    expect(getByRole("textbox")).not.toHaveAttribute("aria-invalid", "true");
  });

  it("shows the error as helper text once typed, and Enter on an invalid value does not commit", async () => {
    const props = base();
    const { user, getByRole, getByText } = renderWithMantine(<PhoneEditor {...props} value={null} surface="popup" />);
    await user.type(getByRole("textbox"), "abc{Enter}");
    expect(getByText(/invalid phone/i)).toBeInTheDocument();
    expect(props.onCommit).not.toHaveBeenCalled();
  });

  it("in a grid cell the error is an in-cell ring + icon with the message as the input's aria-errormessage", async () => {
    const { user, getByRole, getByText } = renderWithMantine(<EmailEditor {...base()} value={null} surface="cell" />);
    const input = getByRole("textbox");
    await user.type(input, "nope");
    expect(input).toHaveAttribute("aria-invalid", "true");
    const describedBy = input.getAttribute("aria-errormessage") ?? "";
    expect(describedBy).not.toBe("");
    expect(getByText(/invalid email/i).id).toBe(describedBy);
  });

  it("Enter commits a valid value", async () => {
    const props = base();
    const { user, getByRole } = renderWithMantine(<EmailEditor {...props} value={null} />);
    await user.type(getByRole("textbox"), "a@b.co{Enter}");
    expect(props.onCommit).toHaveBeenCalledWith("a@b.co");
  });
});
