import { describe, expect, it } from "vitest";
import {
  describeLoadError,
  describeSignedUrlFailure,
} from "@/lib/pdf-viewer/messages";
import {
  clampPage,
  keyToNavigation,
  pageForAction,
  type KeyLike,
} from "@/lib/pdf-viewer/navigation";

function key(name: string, modifiers: Partial<KeyLike> = {}): KeyLike {
  return {
    key: name,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    ...modifiers,
  };
}

describe("clampPage", () => {
  it("keeps a page inside 1..numPages", () => {
    expect(clampPage(0, 10)).toBe(1);
    expect(clampPage(-3, 10)).toBe(1);
    expect(clampPage(5, 10)).toBe(5);
    expect(clampPage(11, 10)).toBe(10);
  });

  it("truncates fractions and treats non-finite pages as 1", () => {
    expect(clampPage(3.9, 10)).toBe(3);
    expect(clampPage(Number.NaN, 10)).toBe(1);
    expect(clampPage(Number.POSITIVE_INFINITY, 10)).toBe(1);
  });

  it("only applies the lower bound while the page count is unknown", () => {
    expect(clampPage(7, Number.POSITIVE_INFINITY)).toBe(7);
    expect(clampPage(0, Number.POSITIVE_INFINITY)).toBe(1);
  });

  it("never goes below 1 for a zero or negative page count", () => {
    expect(clampPage(4, 0)).toBe(1);
    expect(clampPage(4, -2)).toBe(1);
  });
});

describe("pageForAction", () => {
  it("steps and stops at both ends", () => {
    expect(pageForAction("next", 3, 10)).toBe(4);
    expect(pageForAction("next", 10, 10)).toBe(10);
    expect(pageForAction("previous", 3, 10)).toBe(2);
    expect(pageForAction("previous", 1, 10)).toBe(1);
  });

  it("jumps to the first and last page", () => {
    expect(pageForAction("first", 6, 10)).toBe(1);
    expect(pageForAction("last", 6, 10)).toBe(10);
  });
});

describe("keyToNavigation", () => {
  it("maps the four navigation keys", () => {
    expect(keyToNavigation(key("ArrowLeft"))).toBe("previous");
    expect(keyToNavigation(key("ArrowRight"))).toBe("next");
    expect(keyToNavigation(key("Home"))).toBe("first");
    expect(keyToNavigation(key("End"))).toBe("last");
  });

  it("ignores other keys", () => {
    expect(keyToNavigation(key("ArrowUp"))).toBeNull();
    expect(keyToNavigation(key("a"))).toBeNull();
  });

  it("ignores any key with a modifier, so browser shortcuts still work", () => {
    expect(keyToNavigation(key("ArrowLeft", { altKey: true }))).toBeNull();
    expect(keyToNavigation(key("ArrowRight", { metaKey: true }))).toBeNull();
    expect(keyToNavigation(key("ArrowRight", { ctrlKey: true }))).toBeNull();
    expect(keyToNavigation(key("Home", { shiftKey: true }))).toBeNull();
  });
});

describe("failure messages", () => {
  it("has distinct text for each signed-URL failure reason", () => {
    const texts = (["invalid_path", "not_found", "failed"] as const).map(
      describeSignedUrlFailure,
    );
    expect(new Set(texts).size).toBe(3);
  });

  it("recognises known PDF.js errors and falls back for unknown ones", () => {
    expect(describeLoadError("PasswordException")).toMatch(/password/i);
    expect(describeLoadError("InvalidPDFException")).toMatch(/damaged/i);
    expect(describeLoadError("SomethingElse")).toMatch(/could not be loaded/i);
  });

  it("never echoes error details, which may contain a signed URL", () => {
    expect(describeLoadError("https://x/y?token=secret")).not.toMatch(/token/);
  });
});
