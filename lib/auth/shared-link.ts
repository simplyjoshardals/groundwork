import { safeNextPath } from "@/lib/auth/redirect";

type SearchParams = Record<string, string | string[] | undefined>;

// A shared viewer link is `/?doc=<id>&page=<n>&chunk=<id>` (see
// `useViewerLocation`). Only these three keys survive, each checked for shape,
// so a crafted landing URL cannot smuggle anything else into `next`.
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const PAGE = /^\d{1,5}$/;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * The post-auth target for a signed-out visitor who opened `/` with a shared
 * document link. Anything that is not a well-formed link becomes `/`. The
 * result still goes through `safeNextPath`, like every `next` in the app.
 */
export function nextFromSearchParams(params: SearchParams): string {
  const doc = first(params.doc);
  if (!doc || !ID.test(doc)) return "/";

  const query = new URLSearchParams({ doc });
  const page = first(params.page);
  if (page && PAGE.test(page)) query.set("page", page);
  const chunk = first(params.chunk);
  if (chunk && ID.test(chunk)) query.set("chunk", chunk);

  return safeNextPath(`/?${query.toString()}`);
}

/** `/sign-in` or `/sign-up`, carrying `next` only when it is not the home page. */
export function authHref(path: "/sign-in" | "/sign-up", next: string): string {
  return next === "/" ? path : `${path}?next=${encodeURIComponent(next)}`;
}
