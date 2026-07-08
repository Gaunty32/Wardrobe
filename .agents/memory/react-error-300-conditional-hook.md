---
name: React error #300 from time-based auth early-return before a hook
description: A component had an early `return null` (gated on a live JWT-expiry check) placed before a later useQuery call, causing intermittent "Rendered fewer hooks than expected" crashes.
---

## What happened
`order-system`'s `Layout.tsx` (wraps every staff page) called `isStaffAuthenticated()` twice: once for an early `if (!isStaffAuthenticated()) return null;`, and again later to gate a `useQuery` call placed *after* that early return. `isStaffAuthenticated()` is time-based (compares the JWT's `exp` claim to `Date.now()`), so it can return `true` on one render and `false` on a later render of the *same mounted component* — e.g. a staff member leaves a page open long enough for their session token to expire. When that flip happened, the component called fewer hooks on the later render, producing React error #300 ("Rendered fewer hooks than expected") and crashing the whole page via the error boundary, seemingly at random and on any staff page.

**Why:** Conditional early returns before a hook are the classic Rules-of-Hooks violation, but they're easy to miss when the "condition" is something that looks stable at a glance (an auth check) but is actually time-dependent and re-evaluated fresh on every call rather than being derived from state/props.

**How to apply:** When investigating a vague/unreproducible "Rendered fewer hooks than expected" (React error #300) crash that isn't tied to one specific page or user action, suspect a shared layout/wrapper component and check whether any of its early returns are gated on a **time- or clock-based check** (auth/session expiry, `Date.now()`, feature flags with TTLs) rather than a plain prop/state value — these flip mid-session without an explicit state change, unlike normal conditional-render bugs.

## Fast diagnostic
Don't just grep for "if (...) return" near hooks — it's noisy and easy to miss cross-component call order. Instead, spin up a scratch ESLint run with just `eslint-plugin-react-hooks`'s `rules-of-hooks` rule (no other config needed) against the suspect files/whole src tree. It flags the exact conditional-hook-call site directly, which is much faster and more reliable than manual reading for this class of bug.
