import { describe, expect, it } from "vitest";
import { buildSecurityHeaders } from "@/lib/security/headers";
import {
  EXPECTED_STATUS,
  checkSecurityHeaders,
  expectStatus,
  findLeaks,
  isEmptyJsonArray,
  isStorageDenied,
  renderReport,
  responseShape,
  sameShape,
  summarize,
  pass,
  fail,
  skip,
} from "@/scripts/security-audit/checks";

describe("EXPECTED_STATUS (DATA_MODEL 7.2)", () => {
  it("matches the table", () => {
    expect(EXPECTED_STATUS).toEqual({
      A2: [401, 403],
      A3: [401, 403],
      A4: [401, 403],
      A5: [400, 403],
      A6: [401, 403],
      A7: [401, 403, 404],
      A9: [401, 403],
      A10: [400, 404],
      A14: [400, 404],
      A15a: [400, 413],
    });
  });

  it("A7 never accepts a 200", () => {
    expect(expectStatus("A7", "t", 200, EXPECTED_STATUS.A7).outcome).toBe(
      "fail",
    );
    expect(expectStatus("A7", "t", 404, EXPECTED_STATUS.A7).outcome).toBe(
      "pass",
    );
  });
});

describe("isEmptyJsonArray", () => {
  it("accepts only an empty array", () => {
    expect(isEmptyJsonArray("[]")).toBe(true);
    expect(isEmptyJsonArray(" [ ] ")).toBe(true);
    expect(isEmptyJsonArray('[{"id":1}]')).toBe(false);
    expect(isEmptyJsonArray("{}")).toBe(false);
    expect(isEmptyJsonArray("")).toBe(false);
  });
});

describe("isStorageDenied", () => {
  it("accepts 403, and 400 only when the body says it was a policy refusal", () => {
    expect(isStorageDenied(403, "")).toBe(true);
    expect(
      isStorageDenied(400, '{"statusCode":"403","error":"Unauthorized"}'),
    ).toBe(true);
    expect(
      isStorageDenied(
        400,
        '{"message":"new row violates row-level security policy"}',
      ),
    ).toBe(true);
    expect(isStorageDenied(400, '{"message":"Invalid mime type"}')).toBe(false);
    expect(isStorageDenied(200, "{}")).toBe(false);
  });
});

describe("responseShape and sameShape", () => {
  it("describes JSON without values, except the fixed-word fields", () => {
    expect(responseShape(404, '{"error":"not_found"}')).toBe(
      "404 {error=not_found}",
    );
    expect(responseShape(200, '{"status":"ok","id":"abc","n":3}')).toBe(
      "200 {id,n,status=ok}",
    );
    expect(responseShape(200, "[]")).toBe("200 array(0)");
  });

  it("describes a stream by its event names", () => {
    const body = 'data: {"type":"not_found","usage":{"remaining":3}}\n\n';
    expect(responseShape(200, body)).toBe("200 events[not_found]");
  });

  it("passes when two answers match and fails when they differ", () => {
    const a = { status: 404, body: '{"error":"not_found"}' };
    expect(sameShape("O3", "t", a, { ...a }).outcome).toBe("pass");
    const b = { status: 200, body: '{"status":"no_op"}' };
    const result = sameShape("O3", "t", a, b);
    expect(result.outcome).toBe("fail");
    expect(result.detail).toContain("404");
  });

  it("does not put ids or numbers in the detail", () => {
    const id = "123e4567-e89b-42d3-a456-426614174000";
    const result = sameShape(
      "O",
      "t",
      { status: 200, body: `{"documentId":"${id}","count":7}` },
      { status: 404, body: "{}" },
    );
    expect(result.detail).not.toContain(id);
  });
});

describe("findLeaks", () => {
  it("is empty for the app's fixed messages", () => {
    expect(
      findLeaks(
        '{"error":"internal_error","message":"Something went wrong. Please try again."}',
      ),
    ).toEqual([]);
    expect(
      findLeaks(
        '{"error":"invalid_request","message":"documentId must be a UUID string."}',
      ),
    ).toEqual([]);
  });

  it("names each kind it finds, never the text", () => {
    const body = "Error: boom\n    at run (/app/node_modules/x/index.js:10:5)";
    expect(findLeaks(body)).toEqual(
      expect.arrayContaining(["stack trace", "file path"]),
    );
    expect(findLeaks('PGRST116 relation "documents" does not exist')).toContain(
      "SQL or Postgres detail",
    );
    expect(findLeaks("key sb_secret_abcdefgh12345")).toContain("Supabase key");
    expect(findLeaks("AIzaSyA1234567890abcdefghijklmnopqrstuv")).toContain(
      "provider key",
    );
  });
});

describe("checkSecurityHeaders", () => {
  const toGet = (headers: { key: string; value: string }[]) => {
    const map = new Map(headers.map((h) => [h.key.toLowerCase(), h.value]));
    return (name: string) => map.get(name.toLowerCase()) ?? null;
  };
  const real = (isDev: boolean) =>
    buildSecurityHeaders({ supabaseUrl: "https://abc.supabase.co", isDev });

  it("passes the headers the app really sends (production)", () => {
    const results = checkSecurityHeaders(toGet(real(false)), { prod: true });
    expect(results.filter((r) => r.outcome === "fail")).toEqual([]);
  });

  it("passes the dev headers when prod is not claimed, and skips HSTS", () => {
    const results = checkSecurityHeaders(toGet(real(true)), { prod: false });
    expect(results.filter((r) => r.outcome === "fail")).toEqual([]);
    expect(results.find((r) => r.id === "H6")?.outcome).toBe("skip");
  });

  it("fails dev headers when production is claimed", () => {
    const results = checkSecurityHeaders(toGet(real(true)), { prod: true });
    const failed = results.filter((r) => r.outcome === "fail").map((r) => r.id);
    expect(failed).toEqual(expect.arrayContaining(["H5", "H6"]));
  });

  it("fails when everything is missing, and on X-Powered-By", () => {
    const none = checkSecurityHeaders(() => null, { prod: true });
    expect(none.filter((r) => r.outcome === "fail").map((r) => r.id)).toEqual([
      "H1",
      "H2",
      "H3",
      "H4",
      "H5",
      "H6",
    ]);
    const powered = checkSecurityHeaders(
      (n) => (n === "x-powered-by" ? "Next.js" : toGet(real(false))(n)),
      { prod: true },
    );
    expect(powered.find((r) => r.id === "H7")?.outcome).toBe("fail");
  });

  it("rejects a wildcard script source", () => {
    const weak = [
      ...real(false).filter((h) => h.key !== "Content-Security-Policy"),
      {
        key: "Content-Security-Policy",
        value:
          "default-src 'self'; script-src * ; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
      },
    ];
    const h5 = checkSecurityHeaders(toGet(weak), { prod: true }).find(
      (r) => r.id === "H5",
    );
    expect(h5?.outcome).toBe("fail");
    expect(h5?.detail).toContain("script-src allows *");
  });
});

describe("report", () => {
  it("summarizes and renders without bodies", () => {
    const results = [
      pass("A1", "one"),
      fail("A2", "two", "got 200"),
      skip("A3", "three", "why"),
    ];
    expect(summarize(results)).toEqual({ passed: 1, failed: 1, skipped: 1 });
    const text = renderReport(results);
    expect(text).toContain("FAIL  A2");
    expect(text).toContain("1 passed, 1 failed, 1 skipped");
  });
});
