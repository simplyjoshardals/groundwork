import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/update-session";

/** Next 16's replacement for `middleware.ts`: keeps the Supabase session fresh. */
export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  // Everything except static assets. API routes are included on purpose so
  // `/api/ask` sees a refreshed session.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
