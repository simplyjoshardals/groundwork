import { describe, expect, it } from "vitest";
import { cn } from "@/components/ui/cn";

describe("cn", () => {
  it("joins class names with single spaces", () => {
    expect(cn("a", "b", "c")).toBe("a b c");
  });

  it("skips false, null, undefined and empty strings", () => {
    expect(cn("a", false, null, undefined, "", "b")).toBe("a b");
  });

  it("supports the conditional-class pattern", () => {
    const active = false;
    expect(cn("base", active && "on")).toBe("base");
  });
});
