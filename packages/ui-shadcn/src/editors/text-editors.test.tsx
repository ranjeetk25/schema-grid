import { describe, expect, it, vi } from "vitest";
import { FIXTURE_IDS, fixtureColumn } from "../test/fixtures";
import { renderUi } from "../test/render";
import { EmailEditor, PhoneEditor, UrlEditor } from "./ContactEditors";
import { LongTextEditor, LongTextPopupEditor } from "./LongTextEditor";
import { TextEditor } from "./TextEditor";

const base = (id: string = FIXTURE_IDS.notes) => ({
  value: null,
  onChange: vi.fn(),
  onCommit: vi.fn(),
  onCancel: vi.fn(),
  column: fixtureColumn(id),
  config: {},
});

describe("TextEditor", () => {
  it("commits the typed string on Enter", async () => {
    const props = base();
    const { user, getByRole } = renderUi(<TextEditor {...props} />);
    await user.type(getByRole("textbox"), "hello{Enter}");
    expect(props.onCommit).toHaveBeenCalledWith("hello");
  });

  it("cancels on Escape", async () => {
    const props = base();
    const { user, getByRole } = renderUi(<TextEditor {...props} />);
    await user.type(getByRole("textbox"), "abc{Escape}");
    expect(props.onCancel).toHaveBeenCalled();
  });

  it("focuses in grid mode and never grabs focus in form mode", () => {
    const { getByRole, unmount } = renderUi(<TextEditor {...base()} />);
    expect(getByRole("textbox")).toHaveFocus();
    unmount();
    renderUi(<TextEditor {...base()} autoFocus={false} />);
    expect(document.activeElement).toBe(document.body);
  });

  it("shows the error prop under the field and marks it invalid", () => {
    const { getByRole, getByText } = renderUi(<TextEditor {...base()} autoFocus={false} error="Required" />);
    expect(getByRole("textbox")).toHaveAttribute("aria-invalid", "true");
    expect(getByText("Required")).toBeInTheDocument();
  });
});

describe("LongTextEditor", () => {
  it("inserts a newline on plain Enter and does not commit", async () => {
    const props = base();
    const { user, getByRole } = renderUi(<LongTextEditor {...props} />);
    const textarea = getByRole("textbox") as HTMLTextAreaElement;
    await user.type(textarea, "line1{Enter}line2");
    expect(props.onCommit).not.toHaveBeenCalled();
    expect(textarea.value).toBe("line1\nline2");
  });

  it("plain Enter never reaches the grid", async () => {
    const gridKeys: string[] = [];
    const { user, getByRole, container } = renderUi(<LongTextEditor {...base()} />);
    container.addEventListener("keydown", (e) => gridKeys.push(e.key));
    await user.type(getByRole("textbox"), "a{Enter}");
    expect(gridKeys).not.toContain("Enter");
  });

  it("commits on Ctrl+Enter", async () => {
    const props = base();
    const { user, getByRole } = renderUi(<LongTextEditor {...props} />);
    await user.type(getByRole("textbox"), "hi");
    await user.keyboard("{Control>}{Enter}{/Control}");
    expect(props.onCommit).toHaveBeenCalledWith("hi");
  });

  it("renders as an opaque card at least as wide as the cell", () => {
    const { container } = renderUi(<LongTextEditor {...base()} cellWidth={320} />);
    const card = container.querySelector('[data-slot="editor-card"]') as HTMLElement;
    expect(card).not.toBeNull();
    expect(card.className).toContain("sg:bg-popover");
    expect(card.style.minWidth).toBe("max(240px, 320px)");
  });

  it("exports LongTextPopupEditor wrapped as a popup editor", () => {
    expect(LongTextPopupEditor.cellEditorPopup).toBe(true);
    expect(LongTextPopupEditor.cellEditorPopupPosition).toBe("over");
  });
});

describe("EmailEditor", () => {
  it("has inputmode email and shows a hint for an invalid address", async () => {
    const { user, getByRole, getByText, queryByText } = renderUi(<EmailEditor {...base()} />);
    const input = getByRole("textbox");
    expect(input).toHaveAttribute("inputmode", "email");
    await user.type(input, "abc");
    expect(getByText(/invalid email address/i)).toBeInTheDocument();
    expect(input).toHaveAttribute("aria-invalid", "true");
    await user.clear(input);
    await user.type(input, "a@b.co");
    expect(queryByText(/invalid email address/i)).not.toBeInTheDocument();
  });

  it("shows no hint before the user types", () => {
    const { queryByRole } = renderUi(<EmailEditor {...base()} value="not-an-email" />);
    expect(queryByRole("alert")).not.toBeInTheDocument();
  });

  it("blocks an invalid commit on Enter (the grid never sees it) and commits a valid one", async () => {
    const props = base();
    const gridKeys: string[] = [];
    const { user, getByRole, container } = renderUi(<EmailEditor {...props} />);
    container.addEventListener("keydown", (e) => gridKeys.push(e.key));
    const input = getByRole("textbox");
    await user.type(input, "abc{Enter}");
    expect(props.onCommit).not.toHaveBeenCalled();
    expect(gridKeys).not.toContain("Enter");
    await user.clear(input);
    await user.type(input, "a@b.co{Enter}");
    expect(props.onCommit).toHaveBeenCalledWith("a@b.co");
  });

  it("renders the message inside the field stack in form mode", async () => {
    const { user, getByRole, getByText } = renderUi(<EmailEditor {...base()} autoFocus={false} />);
    await user.type(getByRole("textbox"), "x");
    const msg = getByText(/invalid email address/i);
    expect(getByRole("textbox")).toHaveAttribute("aria-describedby", msg.id);
  });
});

describe("PhoneEditor", () => {
  it("has inputmode tel", () => {
    const { getByRole } = renderUi(<PhoneEditor {...base()} />);
    expect(getByRole("textbox")).toHaveAttribute("inputmode", "tel");
  });
});

describe("UrlEditor", () => {
  it("has inputmode url", () => {
    const { getByRole } = renderUi(<UrlEditor {...base(FIXTURE_IDS.website)} />);
    expect(getByRole("textbox")).toHaveAttribute("inputmode", "url");
  });
});
