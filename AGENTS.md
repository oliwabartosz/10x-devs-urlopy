# Repository Guidelines

Urlopy is an Astro 6 SSR app with React 19 islands, TypeScript, Tailwind CSS 4, Supabase auth, and Cloudflare Workers deployment. Product requirements live in `@context/foundation/prd.md`; stack decisions live in `@context/foundation/tech-stack.md`.

## Hard Rules

- Do not write to `context/archive/`; archived changes are immutable.
- Do not edit generated or ignored output: `.astro/`, `dist/`, `.wrangler/`, or `node_modules/`.
- No test runner is configured yet: there is no `npm test`, `vitest`, `jest`, or Playwright config. Do not invent test commands in status reports.

## Commands

- `npm ci` - install from `package-lock.json`; use after dependency or lockfile changes.
- `npx astro sync` - regenerate Astro types before lint/build when env or route types changed.
- `npm run dev` - start the Astro dev server.
- `npm run lint` - run type-checked ESLint, React Compiler, Astro JSX a11y, and Prettier rules.
- `npm run build` - build the Cloudflare SSR output.
- `npm run format` - run Prettier with Astro and Tailwind class sorting plugins.

## Architecture Notes

- `src/pages/` owns Astro pages; `src/pages/api/auth/` owns email/password endpoints; protected pages are listed in `PROTECTED_ROUTES` inside `@src/middleware.ts`.
- Supabase client creation is centralized in `@src/lib/supabase.ts`. It returns `null` when `SUPABASE_URL` or `SUPABASE_KEY` is missing; API routes must handle that case.
- Use `@/*` imports for `src/*`. Shared helpers belong in `src/lib/`; UI primitives live in `src/components/ui/` per `@components.json`.
- Keep static/layout markup in `.astro` files and use React components for hydrated interactivity, as the current auth forms do with `client:load`.

## Style And UI Conventions

- Node is pinned to `22.14.0` in `@.nvmrc`; package manager is npm.
- Prettier uses 2 spaces, semicolons, double quotes, trailing commas, and `printWidth: 120`.
- Merge conditional Tailwind classes with `cn()` from `@src/lib/utils.ts`; do not hand-concatenate long conditional class strings.
- shadcn/ui uses `new-york`, neutral base color, Lucide icons, and aliases in `@components.json`. Add primitives with `npx shadcn@latest add <name>`.

## Env, Auth, And Deployment

- Local Astro/Supabase env uses `.env`; Cloudflare local dev uses `.dev.vars`; both need `SUPABASE_URL` and `SUPABASE_KEY`.
- Local Supabase is optional for auth work; `npx supabase start` requires Docker.
- CI in `@.github/workflows/ci.yml` targets `master` and runs `npm ci`, `npx astro sync`, `npm run lint`, then `npm run build`. Build expects GitHub secrets for `SUPABASE_URL` and `SUPABASE_KEY`.
- There is no commit-message convention in history yet; do not infer one until commits exist.
