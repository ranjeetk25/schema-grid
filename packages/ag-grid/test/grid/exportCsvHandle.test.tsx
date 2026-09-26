/**
 * v0.3: `SchemaGridHandle.exportCsv` returns a promise that REJECTS on failure
 * instead of swallowing export errors.
 */
import { waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { IoExportModule } from "../../src/internal/core";
import { renderGrid } from "../renderGrid";

describe("SchemaGridHandle.exportCsv", () => {
  it("server mode: rejects when the io export fails", async () => {
    const io: IoExportModule = { buildExportBlob: vi.fn(async () => Promise.reject(new Error("io down"))) };
    const g = renderGrid({ props: { mode: "server", io } });
    await g.waitForRows();
    await expect(g.handle.current?.exportCsv("x.csv")).rejects.toThrow("io down");
  });

  it("server mode: resolves once the file was produced", async () => {
    const io: IoExportModule = { buildExportBlob: vi.fn(async () => new Blob(["a,b"], { type: "text/csv" })) };
    const g = renderGrid({ props: { mode: "server", io } });
    await g.waitForRows();
    await expect(g.handle.current?.exportCsv("x.csv")).resolves.toBeUndefined();
    await waitFor(() => expect(io.buildExportBlob).toHaveBeenCalledTimes(1));
  });

  it("client mode: resolves after the synchronous AG export, rejects when it throws", async () => {
    const g = renderGrid();
    await g.waitForRows();
    const api = g.handle.current?.api();
    if (!api) throw new Error("no api");
    const spy = vi.spyOn(api, "exportDataAsCsv").mockImplementation(() => undefined);
    await expect(g.handle.current?.exportCsv("x.csv")).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockImplementation(() => {
      throw new Error("boom");
    });
    await expect(g.handle.current?.exportCsv("x.csv")).rejects.toThrow("boom");
  });
});
