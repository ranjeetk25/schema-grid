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
    expect(LongTextPopupEditor.isPopup).toBe(true);
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
    expect(getByText(/not a valid email/i)).toBeInTheDocument();
    await user.clear(input);
    await user.type(input, "a@b.co");
    expect(queryByText(/not a valid email/i)).not.toBeInTheDocument();
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
