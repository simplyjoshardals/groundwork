import { describe, expect, it } from "vitest";
import {
  AskHttpError,
  describeFailure,
  requestAnswer,
} from "@/lib/ask-client";

async function failWith(response: Response): Promise<unknown> {
  const fetchImpl = (async () => response) as typeof fetch;
  try {
    for await (const event of requestAnswer("q", { fetchImpl })) void event;
  } catch (error) {
    return error;
  }
  throw new Error("expected requestAnswer to throw");
}

describe("503 auth_unavailable (Task 5.9)", () => {
  it("shows the waking-up message and allows retry", async () => {
    const error = await failWith(
      Response.json(
        { error: "auth_unavailable", message: "server text" },
        { status: 503 },
      ),
    );
    expect(error).toBeInstanceOf(AskHttpError);
    expect((error as AskHttpError).code).toBe("auth_unavailable");
    expect(describeFailure(error)).toEqual({
      message: "Demo is waking up. Retry in a minute.",
      retryable: true,
    });
  });

  it("keeps the search message for other 503 bodies", async () => {
    const error = await failWith(
      Response.json({ error: "search_unavailable" }, { status: 503 }),
    );
    expect((error as AskHttpError).code).toBeNull();
    expect(describeFailure(error).message).toContain("Search is temporarily");
  });

  it.each([
    ["an unknown code", JSON.stringify({ error: "something_else" })],
    ["a body that is not JSON", "<html>bad gateway</html>"],
    ["an oversized body", "x".repeat(5_000)],
  ])("ignores %s", async (_label, text) => {
    const error = await failWith(new Response(text, { status: 503 }));
    expect((error as AskHttpError).code).toBeNull();
  });

  it("ignores the code on a status other than 503", async () => {
    const error = await failWith(
      Response.json({ error: "auth_unavailable" }, { status: 500 }),
    );
    expect(describeFailure(error).message).toBe(
      "Something went wrong. Please try again.",
    );
  });
});
