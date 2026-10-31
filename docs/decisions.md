# Decisions log

One dated line per decision that changes the design. Newest at the bottom.

- 2026-10-29: Keep the Next.js `app/` directory at the repo root (no `src/`). Other folders (`components/`, `features/`, `lib/`, `types/`) also live at the root; the `@/*` alias maps to `./*`.
- 2026-10-29: Next 16 replaces `middleware.ts` with `proxy.ts`. Session refresh (task 1.7) goes in a root-level `proxy.ts`.
- 2026-10-29: Removed `cacheComponents` and `partialPrefetching` from `next.config.ts`; neither was intentional and Cache Components changes how cookies and Supabase calls behave.
- 2026-10-29: Local development points at the local Supabase stack via `.env.local`; hosted project values live only in Vercel env vars.
- 2026-10-29: Bumped `@types/node` to `^22` (matches the Node 22 runtime; Vitest 5 requires `^22 || >=24`, and npm refuses to install with `^20`).
- 2026-10-31: Provisional (Task 0.5, not final): embedding model `gemini-embedding-2` at 768 dimensions (`vector(768)` unchanged), no additional L2 normalization because its 768-dimension vectors measured unit length (mean norm 1.0). The adapter must apply the document prefix at ingest and the query prefix at search time. Evidence: `docs/spikes/provider.md` section 5.6 (USER-verified, not independently file-inspected). Still open before this is final: model stability status, a deployed `gemini-embedding-2` test, quota accounting, and ingest performance against the 60 s target.
