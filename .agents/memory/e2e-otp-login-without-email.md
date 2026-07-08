---
name: Testing OTP/email login flows without inbox access
description: How to drive runTest e2e checks past an email-code login step when the agent can't read the inbox
---

The agent cannot read real email inboxes (Resend, SMTP, etc.), so any login flow that emails a
one-time code can't be completed by having a Playwright subagent "check the email."

Two working approaches, both dev-environment-only:

1. **Seed the OTP hash directly in the DB**, then drive the real login UI end to end. The OTP
   store is `{ codeHash: sha256(code), expiresAt }` written to a `settings` key like
   `staff_otp_<email>`. Compute the hash yourself with a chosen plaintext code and upsert it
   before the test runs. Caveat: if the UI itself triggers a "request code" step, it overwrites
   your seeded hash with a real (unreadable) one — only pre-seed if the test won't re-trigger
   send.

2. **Get a valid JWT via a direct API call** (e.g. call the verify-otp endpoint yourself with a
   seeded code once, outside the UI test), then have the runTest plan `[Browser] Execute
   JavaScript: localStorage.setItem('<token-key>', '<token>')` before navigating to the
   authenticated route. This is more robust since it skips the login UI entirely and isn't
   affected by the app re-requesting a fresh code.

**Why:** without one of these, any e2e test plan that requires "enter the code from your email"
will always fail at that step since there's no inbox access.

**How to apply:** prefer approach 2 (token injection) for testing post-login UI/features; use
approach 1 only when the login flow itself is what's being tested. Always clean up any seeded
`settings` rows and reset test data (e.g. avatar_url) back to null afterward — these are real
shared dev accounts, not throwaway fixtures.
