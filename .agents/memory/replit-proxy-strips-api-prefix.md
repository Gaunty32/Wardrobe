---
name: Replit proxy strips /api prefix
description: The Replit external proxy strips the /api path prefix before forwarding to the API server on port 8080; Express must mount routes at both /api and / to handle both direct and proxied requests.
---

## Rule
The API server Express app MUST mount its router at BOTH `/api` and `/`:

```typescript
app.use("/api", router);  // direct access: curl, Vite dev proxy (localhost:19265/api/...)
app.use("/", router);     // Replit external proxy: strips /api prefix before forwarding to port 8080
```

## Why
The Replit reverse proxy routes `/api/*` requests to the API server artifact (port 8080) but **strips the `/api` prefix** in the process. The API server therefore receives `PATCH /settings` (not `PATCH /api/settings`) from browser requests. Without the `/` mount, the router never matches and returns 404 silently.

Evidence: `GET /` health checks in API server logs (not `GET /api/`) confirm prefix-stripping. Direct curl to `localhost:8080/settings` returns 404; `localhost:8080/api/settings` returns 200. Browser via Replit proxy always uses the stripped path.

## How to apply
- Any new Express route added to the router is automatically handled via both mounts — no extra work needed.
- If a second router is ever added, mount it at both `/api/v2` and `/v2` (or similar).
- The Vite dev proxy (`/api → localhost:8080`) forwards the FULL path, so `localhost:19265/api/settings` correctly reaches `localhost:8080/api/settings`. This is why curl tests and Playwright tests through the Vite proxy always worked, masking the production bug.
- Frontend `API_BASE = "/api"` is correct and should NOT be changed; the double-mount on the backend is the right fix.
