import { describe, expect, it } from "vitest";
import {
  createSentinelDetector,
  MAX_LEADING_WHITESPACE,
  NOT_FOUND_SENTINEL,
  type SentinelDecision,
} from "@/lib/ask/sentinel";

/** Feeds chunks until the first decision that is not `pending`. */
function run(chunks: string[], end = true): SentinelDecision {
  const detector = createSentinelDetector();
  for (const chunk of chunks) {
    const decision = detector.push(chunk);
    if (decision.kind !== "pending") return decision;
  }
  return end ? detector.end() : { kind: "pending" };
}

describe("createSentinelDetector", () => {
  it("detects the sentinel in a single chunk", () => {
    expect(run([NOT_FOUND_SENTINEL])).toEqual({ kind: "not_found" });
  });

  it.each([
    [["NOT_", "FOUND"]],
    [["NOT_FOUN", "D"]],
    [["N", "O", "T", "_", "F", "O", "U", "N", "D"]],
  ])("detects the sentinel split across chunks %j", (chunks) => {
    expect(run(chunks)).toEqual({ kind: "not_found" });
  });

  it("waits while the text is still a prefix of the sentinel", () => {
    expect(run(["NOT_FO"], false)).toEqual({ kind: "pending" });
  });

  it("ignores leading whitespace, also when it is its own chunk", () => {
    expect(run(["\n  ", "NOT_FOUND"])).toEqual({ kind: "not_found" });
    expect(run(["  NOT_FOUND\n"])).toEqual({ kind: "not_found" });
  });

  it("refuses when the sentinel is followed by more text", () => {
    expect(run(["NOT_FOUND."])).toEqual({ kind: "not_found" });
    expect(run(["NOT_FOUND", " The documents say nothing."])).toEqual({
      kind: "not_found",
    });
  });

  it("passes an answer straight away and releases the held-back text first", () => {
    const detector = createSentinelDetector();
    expect(detector.push("NOT_")).toEqual({ kind: "pending" });
    expect(detector.push("quite right")).toEqual({
      kind: "pass",
      text: "NOT_quite right",
    });
    // After the decision, chunks pass through untouched and are not inspected.
    expect(detector.push(" NOT_FOUND")).toEqual({
      kind: "pass",
      text: " NOT_FOUND",
    });
  });

  it("does not treat the words 'not found' later in an answer as a refusal", () => {
    const detector = createSentinelDetector();
    expect(detector.push("The file was ")).toEqual({
      kind: "pass",
      text: "The file was ",
    });
    expect(detector.push("not found [1]. NOT_FOUND is a status.")).toEqual({
      kind: "pass",
      text: "not found [1]. NOT_FOUND is a status.",
    });
  });

  it("is case-sensitive and strict about the start", () => {
    expect(run(["Not found"]).kind).toBe("pass");
    expect(run(["not_found"]).kind).toBe("pass");
    expect(run(["`NOT_FOUND`"]).kind).toBe("pass");
    expect(run(["Answer: NOT_FOUND"]).kind).toBe("pass");
  });

  it("releases a partial prefix as a normal answer when the output ends", () => {
    expect(run(["NOT"])).toEqual({ kind: "pass", text: "NOT" });
    expect(run(["NOT_FOUN"])).toEqual({ kind: "pass", text: "NOT_FOUN" });
  });

  it("releases nothing when the output is empty", () => {
    expect(createSentinelDetector().end()).toEqual({ kind: "pass", text: "" });
  });

  it("gives up waiting after too much leading whitespace", () => {
    const spaces = " ".repeat(MAX_LEADING_WHITESPACE + 1);
    expect(run([spaces], false)).toEqual({ kind: "pass", text: spaces });
    expect(run([" ".repeat(MAX_LEADING_WHITESPACE)], false)).toEqual({
      kind: "pending",
    });
  });
});
