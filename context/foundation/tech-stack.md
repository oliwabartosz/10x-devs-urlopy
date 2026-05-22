---
starter_id: 10x-astro-starter
package_manager: npm
project_name: urlopy
hints:
  language_family: js
  team_size: solo
  deployment_target: cloudflare-pages
  ci_provider: github-actions
  ci_default_flow: auto-deploy-on-merge
  bootstrapper_confidence: first-class
  path_taken: standard
  quality_override: false
  self_check_answers: null
  has_auth: true
  has_payments: false
  has_realtime: false
  has_ai: false
  has_background_jobs: false
---

## Why this stack

Urlopy is a small web app with a 3-week MVP window, email/password access control, moderator permissions, and a spreadsheet-like monthly absence grid. The standard JavaScript/TypeScript recommendation is 10x Astro Starter because it gives Astro + React + TypeScript, Supabase auth/database, and Cloudflare Pages deployment out of the box, which keeps the first scaffold close to the course-supported path and minimizes setup friction. The selected hand-off uses Cloudflare Pages, GitHub Actions, and auto-deploy on merge. The later Red Hat server + SQLite requirement is a known manual adaptation after scaffolding; the bootstrapper hand-off stays on the starter's supported Supabase-first defaults.
