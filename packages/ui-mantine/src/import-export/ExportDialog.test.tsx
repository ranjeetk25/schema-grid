import { screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithMantine } from "../test/render";
import { ExportDialog } from "./ExportDialog";

const base = { opened: true, onClose: () => {}, visibleColumnCount: 7, selectedRowCount: 0 };

describe("ExportDialog", () => {
  it("notes the visible column count", () => {
    renderWithMantine(<ExportDialog {...base} onExport={() => {}} />);
    expect(screen.getByText("Includes 7 visible columns")).toBeInTheDocument();
  });

  it("disables Selected when no rows are selected", () => {
    renderWithMantine(<ExportDialog {...base} onExport={() => {}} />);
    expect(screen.getByRole("radio", { name: /Selected/ })).toBeDisabled();
    expect(screen.getByRole("radio", { name: /Current view/ })).toBeChecked();
  });

  it("exports all rows as xlsx and closes", async () => {
    const onExport = vi.fn(async () => {});
    const onClose = vi.fn();
    const { user } = renderWithMantine(<ExportDialog {...base} selectedRowCount={3} onClose={onClose} onExport={onExport} />);
    await user.click(screen.getByRole("radio", { name: /All rows/ }));
    await user.click(screen.getByText("XLSX"));
    await user.click(screen.getByRole("button", { name: "Export" }));
    expect(onExport).toHaveBeenCalledWith({ scope: "all", format: "xlsx" });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("shows an error and stays open when export fails", async () => {
    const onClose = vi.fn();
    const { user } = renderWithMantine(
      <ExportDialog {...base} onClose={onClose} onExport={() => Promise.reject(new Error("Server exploded"))} />,
    );
    await user.click(screen.getByRole("button", { name: "Export" }));
    expect(await screen.findByText("Server exploded")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Export" })).toBeEnabled();
  });
});
