---
name: Facebook page token exchange
description: The token saved via /me/accounts for a System User may not be a valid Page Access Token for posting; always exchange it for a fresh page token before calling /{page}/feed or /{page}/photos.
---

## Rule
Always call `GET /{pageId}?fields=access_token&access_token={storedToken}` before posting to Facebook. Use the returned `access_token` as the actual posting token. Fall back to the stored token only if the exchange fails.

## Why
Facebook System User tokens from Meta Business Manager, when used to call `/me/accounts`, return page tokens that may not carry the correct scopes for posting even if Business Manager shows "Full access". The exchange endpoint (`GET /{page-id}?fields=access_token`) returns a proper Page Access Token that the Facebook Graph API accepts for `/{page}/feed` and `/{page}/photos` POST endpoints.

The `#200 OAuthException` error ("requires pages_manage_posts with page token") is the symptom — it means the token being used for posting is a User/System User token rather than a proper Page Access Token.

## How to apply
The `getFreshPageToken(pageId, token)` helper in `social-posts.ts` implements this. It's called at the start of `publishToFacebook` before any API call. Keep this pattern for any future Facebook posting code.

Also: use form-encoded body (`new URLSearchParams(...)`) for Facebook `/feed` and `/photos` POST requests — more reliable than `Content-Type: application/json` with `access_token` in the body.
