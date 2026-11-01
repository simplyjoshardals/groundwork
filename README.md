# Groundwork: Document Q&A

Upload your own documents, ask questions in plain English, and get answers drawn only from your files, with every claim linked to the exact page and passage it came from.

> Work in progress. See `BUILD_PLAN.md` for the slice-by-slice plan, `REQUIREMENTS.md` for scope, `ARCHITECTURE.md` for design, and `DATA_MODEL.md` for the database and security rules.

## Stack

Next.js (App Router) · TypeScript · Tailwind · Supabase (Auth, Storage, Postgres + pgvector) · free-tier LLM and embeddings · Vitest · Playwright · Vercel

## Scripts

| Command             | What it does                              |
| ------------------- | ----------------------------------------- |
| `yarn dev`          | Start the dev server                      |
| `yarn lint`         | ESLint                                    |
| `yarn typecheck`    | Generate Next route types, then run `tsc` |
| `yarn test`         | Vitest unit tests                         |
| `yarn build`        | Production build                          |
| `yarn format`       | Format everything with Prettier           |
| `yarn format:check` | Check formatting without writing          |
| `yarn db:types`     | Regenerate DB types from the local stack  |
