import { describe, expect, it } from "vitest";
import {
  isUuid,
  parseViewerLocation,
  withViewerParams,
  type ViewerTarget,
} from "@/lib/viewer-url/location";

const DOC = "7d1c0a52-6f43-4b0e-9a55-2f1f5f2c9a10";

const parse = (query: string) =>
  parseViewerLocation(new URLSearchParams(query));

describe("isUuid", () => {
  it("accepts a UUID in either case and rejects other text", () => {
    expect(isUuid(DOC)).toBe(true);
    expect(isUuid(DOC.toUpperCase())).toBe(true);
    expect(isUuid("")).toBe(false);
    expect(isUuid("not-a-uuid")).toBe(false);
    expect(isUuid(`${DOC}x`)).toBe(false);
    expect(isUuid(`../${DOC}`)).toBe(false);
  });
});

describe("parseViewerLocation", () => {
  it("is closed without a doc, ignoring stray page and chunk", () => {
    expect(parse("")).toEqual({ status: "closed" });
    expect(parse("page=3&chunk=9")).toEqual({ status: "closed" });
    expect(parse("q=hello")).toEqual({ status: "closed" });
  });

  it("reads doc, page and chunk", () => {
    expect(parse(`doc=${DOC}&page=7&chunk=412`)).toEqual({
      status: "open",
      documentId: DOC,
      page: 7,
      chunkId: "412",
    });
  });

  it("defaults the page to 1 and the chunk to null", () => {
    expect(parse(`doc=${DOC}`)).toEqual({
      status: "open",
      documentId: DOC,
      page: 1,
      chunkId: null,
    });
  });

  it("lowercases the document id", () => {
    const result = parse(`doc=${DOC.toUpperCase()}`);
    expect(result).toMatchObject({ status: "open", documentId: DOC });
  });

  it("keeps page 0 so the viewer clamps it, instead of rejecting the link", () => {
    expect(parse(`doc=${DOC}&page=0`)).toMatchObject({
      status: "open",
      page: 0,
    });
  });

  it.each([
    ["a malformed doc", "doc=abc"],
    ["an empty doc", "doc="],
    ["a doc with a path", `doc=../${DOC}`],
    ["a non-numeric page", `doc=${DOC}&page=abc`],
    ["a negative page", `doc=${DOC}&page=-1`],
    ["a fractional page", `doc=${DOC}&page=1.5`],
    ["an empty page", `doc=${DOC}&page=`],
    ["a huge page", `doc=${DOC}&page=99999999`],
    ["a non-numeric chunk", `doc=${DOC}&chunk=abc`],
    ["a zero chunk", `doc=${DOC}&chunk=0`],
    ["a chunk with a leading zero", `doc=${DOC}&chunk=012`],
    ["a chunk beyond a safe integer", `doc=${DOC}&chunk=1234567890123456`],
  ])("marks %s as invalid", (_name, query) => {
    expect(parse(query)).toEqual({ status: "invalid" });
  });
});

describe("withViewerParams", () => {
  const target: ViewerTarget = { documentId: DOC, page: 4, chunkId: "88" };

  it("adds the three params to an empty query", () => {
    expect(withViewerParams("", target)).toBe(`?doc=${DOC}&page=4&chunk=88`);
  });

  it("omits chunk when there is none", () => {
    expect(withViewerParams("", { ...target, chunkId: null })).toBe(
      `?doc=${DOC}&page=4`,
    );
  });

  it("replaces existing viewer params and keeps unrelated ones", () => {
    const search = `?q=a%20b&doc=old&page=1&chunk=2&lang=en`;
    const result = new URLSearchParams(withViewerParams(search, target));
    expect(result.get("q")).toBe("a b");
    expect(result.get("lang")).toBe("en");
    expect(result.get("doc")).toBe(DOC);
    expect(result.get("page")).toBe("4");
    expect(result.get("chunk")).toBe("88");
  });

  it("removes the viewer params when closing, and nothing else", () => {
    expect(withViewerParams(`?doc=${DOC}&page=4&chunk=88&lang=en`, null)).toBe(
      "?lang=en",
    );
    expect(withViewerParams(`?doc=${DOC}&page=4`, null)).toBe("");
    expect(withViewerParams("", null)).toBe("");
  });

  it("round-trips through parseViewerLocation", () => {
    const query = withViewerParams("", target);
    expect(parseViewerLocation(new URLSearchParams(query))).toEqual({
      status: "open",
      ...target,
    });
  });
});
