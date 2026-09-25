import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useDocumentVisible } from "../../src/sync/useDocumentVisible";

function setVisibilityState(state: DocumentVisibilityState): void {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
}

describe("useDocumentVisible", () => {
  afterEach(() => {
    setVisibilityState("visible");
  });

  it("reflects the current document.visibilityState", () => {
    setVisibilityState("visible");
    const { result } = renderHook(() => useDocumentVisible());
    expect(result.current).toBe(true);
  });

  it("updates on visibilitychange", () => {
    setVisibilityState("visible");
    const { result } = renderHook(() => useDocumentVisible());
    expect(result.current).toBe(true);

    act(() => {
      setVisibilityState("hidden");
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(result.current).toBe(false);

    act(() => {
      setVisibilityState("visible");
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(result.current).toBe(true);
  });
});
