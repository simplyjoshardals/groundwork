import { describe, expect, it } from "vitest";
import {
  THEME_SCRIPT,
  THEME_STORAGE_KEY,
} from "@/lib/theme/theme-script";

type Env = {
  stored?: string | null;
  storageThrows?: boolean;
  systemDark?: boolean;
  matchMediaThrows?: boolean;
};

/** Runs the inline script against stubbed globals and returns `data-theme`. */
function run({
  stored = null,
  storageThrows = false,
  systemDark = false,
  matchMediaThrows = false,
}: Env): string | undefined {
  const attrs: Record<string, string> = {};
  const document = {
    documentElement: {
      setAttribute: (name: string, value: string) => {
        attrs[name] = value;
      },
    },
  };
  const localStorage = {
    getItem: (key: string) => {
      if (storageThrows) throw new Error("storage blocked");
      return key === THEME_STORAGE_KEY ? stored : null;
    },
  };
  const matchMedia = (query: string) => {
    if (matchMediaThrows) throw new Error("matchMedia unavailable");
    return { matches: query.includes("dark") ? systemDark : false };
  };
  new Function("document", "localStorage", "matchMedia", THEME_SCRIPT)(
    document,
    localStorage,
    matchMedia,
  );
  return attrs["data-theme"];
}

describe("theme script", () => {
  it("uses a stored light choice even when the OS is dark", () => {
    expect(run({ stored: "light", systemDark: true })).toBe("light");
  });

  it("uses a stored dark choice even when the OS is light", () => {
    expect(run({ stored: "dark", systemDark: false })).toBe("dark");
  });

  it("follows the OS for a stored system choice", () => {
    expect(run({ stored: "system", systemDark: true })).toBe("dark");
    expect(run({ stored: "system", systemDark: false })).toBe("light");
  });

  it("follows the OS when nothing is stored", () => {
    expect(run({ stored: null, systemDark: true })).toBe("dark");
    expect(run({ stored: null, systemDark: false })).toBe("light");
  });

  it("ignores an unrecognised stored value", () => {
    expect(run({ stored: "purple", systemDark: true })).toBe("dark");
    expect(run({ stored: "", systemDark: false })).toBe("light");
  });

  it("falls back to the OS when storage throws", () => {
    expect(run({ storageThrows: true, systemDark: true })).toBe("dark");
  });

  it("falls back to light when matchMedia throws", () => {
    expect(run({ stored: "system", matchMediaThrows: true })).toBe("light");
  });

  it("never throws, and always sets exactly light or dark", () => {
    const result = run({ storageThrows: true, matchMediaThrows: true });
    expect(["light", "dark"]).toContain(result);
  });
});
