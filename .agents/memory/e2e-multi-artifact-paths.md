---
name: E2E testing across path-routed artifacts
description: How to navigate correctly when running runTest e2e plans against artifacts served under a path prefix (e.g. /customer-portal/).
---

Each web artifact in this monorepo is served under its own path prefix (the `previewPath` / Vite `BASE_PATH`, e.g. `/customer-portal/`), all proxied through the same domain. The api-server artifact is separately mounted under `/api` on that same domain.

**Rule:** every in-app navigation path used in a `runTest` test plan (or any manual browser check) must include the full artifact prefix, e.g. `/customer-portal/team`, `/customer-portal/preview-login?token=...`. Never navigate to a bare path like `/team` or `/preview-login`.

**Why:** bare paths either 404 against the platform router or get served by a *different* artifact entirely (e.g. order-system's not-found page), producing misleading failures that look like auth/backend bugs (401s, blank pages) when the real cause is just a missing path prefix.

**How to apply:** before writing a runTest plan, check `artifacts/<name>/.replit-artifact/artifact.toml` for the `previewPath`, and prefix all `[Browser] Navigate to ...` steps with it. When debugging a "login redirects to error" or "404" e2e failure, check the navigated path for a missing artifact prefix before suspecting the backend.

To generate a short-lived auth/preview JWT for e2e testing without going through email/magic-link flows, curl the internal preview endpoint directly on localhost (bash tool can reach `localhost:<api-server-port>` even though the sandbox's `code_execution` environment cannot resolve `REPLIT_DEV_DOMAIN`). Then embed the resulting token into the `runTest` plan's navigation URL.
