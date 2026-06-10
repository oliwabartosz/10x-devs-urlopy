---
id: sentry-integration
title: "S-12: Sentry SDK — error tracking dla Cloudflare Workers"
status: implemented
created: 2026-06-10
updated: 2026-06-10
roadmap_id: S-12
prerequisites: []
parallel_with: [dev-vars-rename, admin-bootstrap]
---

# S-12: Sentry SDK — error tracking dla Cloudflare Workers

**Outcome:** Sentry SDK (`@sentry/cloudflare`) wdrożone w aplikacji Cloudflare Workers — nieobsłużone wyjątki i odrzucone Promise'y są automatycznie raportowane do Sentry z pełnym stack trace'em i source mapami. Deweloper może debugować błędy produkcyjne bez ręcznego przeszukiwania `wrangler tail`. Opcjonalnie: alerty Sentry na Slack/e-mail przy nowych błędach.
