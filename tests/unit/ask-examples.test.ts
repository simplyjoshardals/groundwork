import { describe, expect, it } from "vitest";
import dataset from "@/eval/dataset/qa.json";
import { EXAMPLE_QUESTIONS } from "@/lib/ask-client/examples";
import { MAX_QUESTION_LENGTH } from "@/lib/ask/limits";

describe("EXAMPLE_QUESTIONS", () => {
  it.each(EXAMPLE_QUESTIONS.map((e) => [e.label, e] as const))(
    "%s matches the eval dataset and its answerable flag",
    (_label, example) => {
      const entry = dataset.find((item) => item.question === example.question);
      expect(entry).toBeDefined();
      expect(entry?.answerable).toBe(!example.unanswerable);
      expect(example.question.length).toBeLessThanOrEqual(MAX_QUESTION_LENGTH);
    },
  );

  it("offers exactly one refusal example", () => {
    expect(EXAMPLE_QUESTIONS.filter((e) => e.unanswerable)).toHaveLength(1);
  });
});
