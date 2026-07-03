---
name: Portal JWT secret fallback consistency
description: Multiple api-server route files independently hardcode a fallback string for PORTAL_JWT_SECRET when the env var is unset — these must match or tokens silently fail verification.
---

`portal.ts` and `staff-auth.ts` use `process.env.PORTAL_JWT_SECRET || "sbs-portal-secret-change-in-production"` as the signing/verification secret. A separate file (`demo.ts`, used for the public marketing-site demo flow) independently defined its own fallback (`"portal-secret-change-me"`).

**Why:** When `PORTAL_JWT_SECRET` isn't set in the environment (true in dev), each file falls back to its own hardcoded default. If two files disagree, a token signed in one file verifies as invalid everywhere else — surfacing as a generic "Invalid or expired token" error with no clue that the actual bug is a secret mismatch, not an auth/expiry problem.

**How to apply:** Whenever adding a new file that signs or verifies portal JWTs, reuse the same fallback constant as `portal.ts` (`"sbs-portal-secret-change-in-production"`) rather than inventing a new default string. Better yet, if touching this area, consider extracting the secret to a single shared constant/module.
