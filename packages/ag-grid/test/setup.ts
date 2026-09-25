import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

// jsdom gaps AG Grid and our hooks touch.

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
}

if (typeof window !== "undefined" && typeof window.matchMedia !== "function") {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string): MediaQueryList =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }) as MediaQueryList,
  });
}

function installClipboardMock(): void {
  let text = "";
  Object.defineProperty(globalThis.navigator, "clipboard", {
    configurable: true,
    writable: true,
    value: {
      writeText: vi.fn(async (value: string) => {
        text = value;
      }),
      readText: vi.fn(async () => text),
    },
  });
}

if (typeof navigator !== "undefined") {
  installClipboardMock();
}

afterEach(() => {
  cleanup();
  if (typeof navigator !== "undefined") installClipboardMock();
});
