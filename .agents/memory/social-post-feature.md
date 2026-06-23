---
name: Social Post Feature
description: AI-generated social media posts for products — Facebook auto-post, Google copy-paste, 6-month scheduler
---

## Architecture
- `social_posts` table (ensured on startup via startup-migrations.ts)
- Route file: `artifacts/api-server/src/routes/social-posts.ts` — mounted in routes/index.ts
- Scheduler: `startSocialPostScheduler()` exported from social-posts.ts, called from index.ts after startup migrations
- Anthropic SDK: `@anthropic-ai/sdk` installed in api-server; uses `AI_INTEGRATIONS_ANTHROPIC_API_KEY` + `AI_INTEGRATIONS_ANTHROPIC_BASE_URL`

## AI Model
- Model: `claude-sonnet-4-6` — do NOT set temperature/top_p

## API Routes
- GET/POST `/products/:pid/social-posts`
- POST `/products/:pid/social-posts/generate` — AI generation, returns { facebookContent, googleContent, hashtags }
- PATCH/DELETE `/social-posts/:id`
- POST `/social-posts/:id/publish` — posts to Facebook Graph API v20.0
- POST `/social-posts/:id/schedule` — sets status=scheduled with date ~6 months out

## Facebook
- Settings keys: `facebook_page_id`, `facebook_page_access_token` in settings table
- Posts via `POST https://graph.facebook.com/v20.0/{page_id}/feed`
- Hashtags appended to message body separated by newlines

## Google Business
- NOT automated (requires OAuth). Google content is copy-paste only.
- Copy button in Social Post tab copies Google content to clipboard.

## Auto-reschedule
- `randomFutureDate(5.5, 6.5)` — random date 5.5–6.5 months from now
- When a post is published and `auto_reschedule=true`, a new scheduled post is created automatically

## Frontend
- `ProductDetail.tsx`: "Social Post" tab after Guidance tab; shows badge with scheduled count
- `Settings.tsx`: "Social Media" tab at end of integrations tabs; Facebook Page ID + Access Token fields

**Why:** Google Business Profile API requires OAuth flow not worth implementing; Facebook Graph API v20.0 uses simple bearer token with page access token.
