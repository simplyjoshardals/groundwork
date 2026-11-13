import type { NextConfig } from "next";
import { buildSecurityHeaders } from "./lib/security/headers";

const nextConfig: NextConfig = {
  // No `X-Powered-By: Next.js` header: it tells a scanner what to look for.
  poweredByHeader: false,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [
      {
        source: "/:path*",
        // `NEXT_PUBLIC_SUPABASE_URL` is read here, at build/start. When it is
        // missing (the CI build has no env) the CSP simply omits the Supabase
        // origin; an invalid value throws (lib/security/headers.ts).
        headers: buildSecurityHeaders({
          supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
          isDev: process.env.NODE_ENV !== "production",
        }),
      },
    ];
  },
};

export default nextConfig;
