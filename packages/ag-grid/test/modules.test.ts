import * as community from "ag-grid-community";
import { describe, expect, it } from "vitest";
import { SCHEMA_GRID_CLIENT_MODULES, SCHEMA_GRID_INFINITE_MODULES } from "../src/agModules";

const communityModules = new Set(Object.values(community).filter((v) => v && typeof v === "object"));

describe("community module sets", () => {
  it.each([
    ["client", SCHEMA_GRID_CLIENT_MODULES],
    ["infinite", SCHEMA_GRID_INFINITE_MODULES],
  ])("%s: every module is defined and comes from ag-grid-community", (_name, modules) => {
    expect(modules.length).toBeGreaterThan(0);
    for (const m of modules) {
      expect(m).toBeDefined();
      expect(communityModules.has(m)).toBe(true);
    }
  });

  it("client set has the client-side row model, infinite set has the infinite row model", () => {
    expect(SCHEMA_GRID_CLIENT_MODULES).toContain(community.ClientSideRowModelModule);
    expect(SCHEMA_GRID_CLIENT_MODULES).toContain(community.ClientSideRowModelApiModule);
    expect(SCHEMA_GRID_CLIENT_MODULES).not.toContain(community.InfiniteRowModelModule);
    expect(SCHEMA_GRID_INFINITE_MODULES).toContain(community.InfiniteRowModelModule);
    expect(SCHEMA_GRID_INFINITE_MODULES).not.toContain(community.ClientSideRowModelModule);
  });

  it("excludes built-in undo and built-in filters (we own those)", () => {
    for (const set of [SCHEMA_GRID_CLIENT_MODULES, SCHEMA_GRID_INFINITE_MODULES]) {
      expect(set).not.toContain(community.UndoRedoEditModule);
      expect(set).not.toContain(community.TextFilterModule);
      expect(set).not.toContain(community.NumberFilterModule);
      expect(set).not.toContain(community.DateFilterModule);
      expect(set).not.toContain(community.AllCommunityModule);
    }
  });
});
