import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Option } from "../internal/core-contracts";
import { isPopupEditor } from "../internal/grid-contracts";
import { FIXTURE_IDS, FIXTURE_USERS, buildStubDataSource, fixtureColumn } from "../test/fixtures";
import { renderWithMantine } from "../test/render";
import { AsyncCombobox } from "./AsyncCombobox";
import { UserPickerEditor, UserPickerPopupEditor } from "./UserPickerEditor";

const column = fixtureColumn(FIXTURE_IDS.owner);

function setup(overrides: Partial<Parameters<typeof UserPickerEditor>[0]> = {}, env: "test" | "default" = "test") {
  const dataSource = buildStubDataSource();
  const props = {
    value: null,
    onChange: vi.fn(),
    onCommit: vi.fn(),
    onCancel: vi.fn(),
    column,
    config: column.config,
    dataSource,
    ...overrides,
  };
  const utils = renderWithMantine(<UserPickerEditor {...props} />, { env });
  return { ...utils, props, dataSource };
}

function deferred<T>() {
  let resolve: (v: T) => void = () => {};
  let reject: (e: unknown) => void = () => {};
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/**
 * Fake-timer tests use fireEvent: RTL's asyncWrapper (used by user-event)
 * drains with a real `setTimeout(0)` that never fires under Vitest fake timers.
 * Emits one change event per keystroke, starting from the current value.
 */
function typeKeystrokes(input: HTMLElement, text: string) {
  const current = (input as HTMLInputElement).value;
  for (let i = current.length + 1; i <= text.length; i++) {
    fireEvent.change(input, { target: { value: text.slice(0, i) } });
  }
}

afterEach(() => {
  vi.useRealTimers();
});

describe("UserPickerEditor", () => {
  it("is exported as a popup editor", () => {
    expect(isPopupEditor(UserPickerPopupEditor)).toBe(true);
    expect(UserPickerPopupEditor.component).toBe(UserPickerEditor);
  });

  it("opening calls getOptions once with an empty search", async () => {
    const { dataSource } = setup();
    expect(await screen.findByText("Asha Rao")).toBeInTheDocument();
    expect(dataSource.getOptions).toHaveBeenCalledTimes(1);
    expect(dataSource.getOptions).toHaveBeenCalledWith(column.id, "");
  });

  it("does not load until opened when autoFocus is false", async () => {
    const { dataSource, user } = setup({ autoFocus: false });
    expect(dataSource.getOptions).not.toHaveBeenCalled();
    await user.click(screen.getByRole("textbox"));
    expect(await screen.findByText("Asha Rao")).toBeInTheDocument();
    expect(dataSource.getOptions).toHaveBeenCalledTimes(1);
  });

  it("typing debounces to a single call", async () => {
    vi.useFakeTimers();
    const { dataSource } = setup();
    await act(async () => {});
    expect(dataSource.getOptions).toHaveBeenCalledTimes(1);
    typeKeystrokes(screen.getByRole("textbox"), "vik");
    await act(async () => {
      vi.advanceTimersByTime(100);
    });
    expect(dataSource.getOptions).toHaveBeenCalledTimes(1);
    await act(async () => {
      vi.advanceTimersByTime(250);
    });
    expect(dataSource.getOptions).toHaveBeenCalledTimes(2);
    expect(dataSource.getOptions).toHaveBeenLastCalledWith(column.id, "vik");
  });

  it("results show the avatar image or initials and the name", async () => {
    setup();
    expect(await screen.findByText("Asha Rao")).toBeInTheDocument();
    expect(screen.getByText("Vikram Singh")).toBeInTheDocument();
    const img = document.querySelector('img[src="https://example.com/asha.png"]');
    expect(img).not.toBeNull();
    expect(screen.getByText("VS")).toBeInTheDocument();
  });

  it("selecting emits a UserRef and commits", async () => {
    const { user, props } = setup();
    await user.click(await screen.findByRole("option", { name: /Vikram Singh/ }));
    expect(props.onChange).toHaveBeenCalledWith({ id: "u_vikram", name: "Vikram Singh" });
    expect(props.onCommit).toHaveBeenCalledWith({ id: "u_vikram", name: "Vikram Singh" });
  });

  it("Enter picks the first result while searching", async () => {
    const { user, props, dataSource } = setup();
    dataSource.getOptions.mockImplementation(async (_c, search) =>
      FIXTURE_USERS.filter((u) => u.label.toLowerCase().includes((search ?? "").toLowerCase())),
    );
    await screen.findByText("Asha Rao");
    await user.type(screen.getByRole("textbox"), "vik");
    await waitFor(() => expect(screen.queryByText("Asha Rao")).not.toBeInTheDocument());
    await user.keyboard("{Enter}");
    expect(props.onCommit).toHaveBeenCalledWith({ id: "u_vikram", name: "Vikram Singh" });
  });

  it("Escape cancels", async () => {
    const { user, props } = setup();
    await screen.findByText("Asha Rao");
    await user.keyboard("{Escape}");
    expect(props.onCancel).toHaveBeenCalled();
  });

  it("a slower earlier response arriving after a later one does not overwrite the results", async () => {
    vi.useFakeTimers();
    const slow = deferred<Option[]>();
    const { dataSource } = setup();
    dataSource.getOptions.mockImplementation(async (_c, search) => {
      if (search === "a") return slow.promise;
      if (search === "as") return [FIXTURE_USERS[0] as Option];
      return FIXTURE_USERS;
    });
    await act(async () => {});
    const input = screen.getByRole("textbox");
    typeKeystrokes(input, "a");
    await act(async () => {
      vi.advanceTimersByTime(250);
    });
    typeKeystrokes(input, "as");
    await act(async () => {
      vi.advanceTimersByTime(250);
    });
    expect(dataSource.getOptions).toHaveBeenCalledWith(column.id, "a");
    expect(dataSource.getOptions).toHaveBeenCalledWith(column.id, "as");
    expect(screen.getByText("Asha Rao")).toBeInTheDocument();
    expect(screen.queryByText("Vikram Singh")).not.toBeInTheDocument();
    await act(async () => {
      slow.resolve([{ id: "u_stale", label: "Stale Person" }]);
    });
    expect(screen.queryByText("Stale Person")).not.toBeInTheDocument();
    expect(screen.getByText("Asha Rao")).toBeInTheDocument();
  });

  it("keeps the dropdown inside the container with portals enabled", async () => {
    const { container } = setup({}, "default");
    const node = await screen.findByText("Asha Rao");
    expect(container.contains(node)).toBe(true);
  });
});

describe("AsyncCombobox", () => {
  it("shows the empty state", async () => {
    renderWithMantine(
      <AsyncCombobox<Option>
        load={async () => []}
        getKey={(o) => o.id}
        getLabel={(o) => o.label}
        onSelect={vi.fn()}
      />,
    );
    expect(await screen.findByText("No results")).toBeInTheDocument();
  });

  it("shows the loading state", async () => {
    const d = deferred<Option[]>();
    renderWithMantine(
      <AsyncCombobox<Option> load={() => d.promise} getKey={(o) => o.id} getLabel={(o) => o.label} onSelect={vi.fn()} />,
    );
    expect(screen.getByText("Loading…")).toBeInTheDocument();
    await act(async () => {
      d.resolve(FIXTURE_USERS);
    });
    expect(screen.queryByText("Loading…")).not.toBeInTheDocument();
  });

  it("shows the error state", async () => {
    renderWithMantine(
      <AsyncCombobox<Option>
        load={async () => {
          throw new Error("Network down");
        }}
        getKey={(o) => o.id}
        getLabel={(o) => o.label}
        onSelect={vi.fn()}
      />,
    );
    expect(await screen.findByText(/Network down/)).toBeInTheDocument();
  });

  it("uses renderItem when given", async () => {
    renderWithMantine(
      <AsyncCombobox<Option>
        load={async () => FIXTURE_USERS}
        getKey={(o) => o.id}
        getLabel={(o) => o.label}
        renderItem={(o) => <b>custom-{o.id}</b>}
        onSelect={vi.fn()}
      />,
    );
    expect(await screen.findByText("custom-u_asha")).toBeInTheDocument();
  });
});
