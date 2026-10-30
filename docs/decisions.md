# Decisions log

One dated line per decision that changes the design. Newest at the bottom.

- 2026-10-29: Keep the Next.js `app/` directory at the repo root (no `src/`). Other folders (`components/`, `features/`, `lib/`, `types/`) also live at the root; the `@/*` alias maps to `./*`.
- 2026-10-29: Next 16 replaces `middleware.ts` with `proxy.ts`. Session refresh (task 1.7) goes in a root-level `proxy.ts`.
- 2026-10-29: Removed `cacheComponents` and `partialPrefetching` from `next.config.ts`; neither was intentional and Cache Components changes how cookies and Supabase calls behave.
- 2026-10-29: Local development points at the local Supabase stack via `.env.local`; hosted project values live only in Vercel env vars.
- 2026-10-29: Bumped `@types/node` to `^22` (matches the Node 22 runtime; Vitest 5 requires `^22 || >=24`, and npm refuses to install with `^20`).
