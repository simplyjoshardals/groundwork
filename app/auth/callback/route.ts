import { NextResponse, type NextRequest } from "next/server";
import { safeNextPath } from "@/lib/auth/redirect";
import { createServerSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_CODE_LENGTH = 512;

/**
 * Landing point for links in Supabase Auth emails (PKCE flow): swaps the
 * one-time `code` for a session, which `@supabase/ssr` writes to cookies, then
 * continues to `next`. Any failure goes to the sign-in page with a generic
 * flag; nothing from the provider is echoed.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const failure = () =>
    NextResponse.redirect(new URL("/sign-in?error=callback", origin));

  const code = searchParams.get("code");
  if (!code || code.length > MAX_CODE_LENGTH) return failure();

  try {
    const supabase = await createServerSupabase();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      console.warn(`[auth-callback] code exchange failed: ${error.name}`);
      return failure();
    }
  } catch (err) {
    console.error(
      "[auth-callback] code exchange threw:",
      err instanceof Error ? err.name : "unknown",
    );
    return failure();
  }

  return NextResponse.redirect(
    new URL(safeNextPath(searchParams.get("next")), origin),
  );
}
