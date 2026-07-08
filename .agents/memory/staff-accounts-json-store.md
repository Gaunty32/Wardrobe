---
name: Staff accounts JSON store
description: Where order-system staff accounts live and the identity constraint on password-only logins
---

Order-system staff accounts are not a relational table. They live as a JSON array under
`settings.staff_accounts` (key/value settings table), managed by
`artifacts/api-server/src/routes/staff-auth.ts`. Each entry is `{ name, email? }`.

There are two distinct staff login modes:
- **Email + OTP login** — has an `email`, gets a JWT keyed by that email. This is the only mode
  that can have per-account profile data (e.g. an avatar), since the email is the identity key.
- **Password-only login** (shared `staff_password_hash` in settings, no email) — grants a
  superuser-style session with no individual identity. By design these accounts cannot have a
  profile photo or other per-user data, since there's nothing to key the record on.

**Why:** any new per-staff-user feature (avatars, preferences, notification settings, etc.) needs
an email to attach to. Check `canHavePhoto = !!email`-style guards before assuming every logged-in
staff session has an identity.

**How to apply:** when adding staff-scoped fields, extend the `StaffAccount` interface in
`staff-auth.ts`, add a self-service `PATCH /auth/staff/me/<field>` route keyed by the JWT email
(not requiring superuser), and gate any UI for it on the session actually having an email.
