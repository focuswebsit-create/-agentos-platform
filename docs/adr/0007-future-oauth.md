# ADR-0007 — Google OAuth: prepared, not implemented

- **Status:** Accepted (P1)
- **Date:** 2026-11-14

## Context
The owner asked for a future path to Google sign-in without building it in P1. The Supabase Development project currently has **every** external provider disabled (verified: `external.google: false`).

## Decision
No provider button, no `signInWithOAuth` call. What keeps the door open:

- the auth module never assumes a password is the only factor;
- `public.profiles` is keyed on `auth.users.id` and carries nothing password-specific, so an OAuth user gets a profile from the same `handle_new_user()` trigger;
- `/auth/callback` already handles both the PKCE `code` and the `token_hash` + `type` forms, which is what an OAuth redirect lands on.

Adding Google later is: enable the provider in the dashboard, add the redirect URL, and add one call site.

## Open question for that PR
Account linking. If someone signs up with a password and later signs in with Google using the same address, Supabase may create a second identity or link them depending on project settings. That is a product decision — silently linking is convenient but lets anyone who controls an email provider take over an existing password account. It must be settled before the provider is switched on, not after.

## Consequences
- No dead OAuth code and no disabled button implying a feature that does not exist.
- The account-linking decision is recorded now, while the context is fresh, rather than discovered during the OAuth PR.
