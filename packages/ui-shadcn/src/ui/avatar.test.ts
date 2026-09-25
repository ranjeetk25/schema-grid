import { describe, expect, it } from "vitest";
import { avatarTone, initials } from "./avatar";

describe("initials", () => {
  it("takes first + last word initials", () => {
    expect(initials("Asha Rao")).toBe("AR");
    expect(initials("Vikram Singh")).toBe("VS");
  });

  it("ignores punctuation-only words and punctuation inside words", () => {
    expect(initials("Priya (remote)")).toBe("PR");
    expect(initials("(bot)")).toBe("BO");
    expect(initials("  ")).toBe("?");
  });

  it("gives a stable tone per name", () => {
    expect(avatarTone("Asha Rao")).toBe(avatarTone("Asha Rao"));
  });
});
