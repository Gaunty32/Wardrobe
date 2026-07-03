---
name: Zod optional string fields must accept blank strings
description: Frontend forms send "" (not undefined/null) for unset optional text/email fields — z.string().optional()/.email().optional() rejects "" and causes confusing generic save failures.
---

Controlled React inputs bound to `useState` almost always initialize optional fields to `""`, and forms submit that `""` rather than omitting the key or sending `null`. A Zod schema like `z.string().email().optional().nullable()` still runs `.email()` validation against `""` and fails, because `optional()`/`nullable()` only skip validation for `undefined`/`null`, not for an empty string.

**Why:** This caused a real bug where every "add/update employee" request with a blank email field failed server-side validation, surfaced to the user as a generic "Failed to add/update employee" toast with no indication that email was the problem.

**How to apply:** For optional text/email fields fed by controlled form inputs, use a schema helper that treats `""` as equivalent to absent — e.g. `z.string().trim().transform(v => v === "" ? null : v).pipe(z.string().email().nullable())`, or a `preprocess` step that maps `""` to `null`/`undefined` before the real validator runs. Apply this pattern to any new optional string/email fields in API request schemas fed by React forms.
