import { describe, expect, it } from "vitest";
import { cn } from "./cn";

describe("cn", () => {
  it("dedupes conflicting prefixed utilities (last wins)", () => {
    expect(cn("sg:px-2 sg:h-8", "sg:px-3")).toBe("sg:h-8 sg:px-3");
  });

  it("keeps non-tailwind hook classes", () => {
    expect(cn("sg-ui", false && "x", "sg:text-sm")).toBe("sg-ui sg:text-sm");
  });
});
