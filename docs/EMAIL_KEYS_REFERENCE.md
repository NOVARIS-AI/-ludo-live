# LUDO LIVE transactional email credentials reference

This document explains every configuration value used by the transactional email system, what it authorizes, and which player-facing flows depend on it. Configure credentials on the **staging Worker only** while validating this branch. Never commit provider credentials, place them in frontend variables, or paste them into chat.

## Credential and configuration map

| Name | Type | Required now? | Purpose | Used by |
|---|---|---:|---|---|
| `RESEND_API_KEY` | Secret API credential | Yes, for current staging email delivery | Authenticates LUDO LIVE to Resend's email API. Resend is attempted first. | `sendWithResend()` in `worker/email.ts`, called through `sendTransactionalEmail()`. |
| `LUDO_EMAIL_FROM` | Sender-address variable (not an API key) | Yes | Sets the visible From identity on outgoing messages. The address/domain must be verified with the provider. | Passed as `from` to Resend and parsed into Brevo's `sender` object by `sendWithBrevo()`. |
| `BREVO_API_KEY` | Secret API credential | No; optional future fallback | Authenticates LUDO LIVE to Brevo. Brevo is tried only if Resend is absent, throws, or returns a non-success response. | `sendWithBrevo()` in `worker/email.ts`, called by `sendTransactionalEmail()` after the Resend attempt fails. |
| `LUDO_APP_ORIGIN` | URL variable (not a key) | Yes for correct email links | Supplies the app origin used to construct verification and password-reset links. In staging it must be the staging Pages origin. | Email-action URL construction in `worker/index.ts`; injected by the staging workflow during Worker deployment. |

## Which player features use email delivery?

All transactional messages share `sendTransactionalEmail(env, to, subject, html)` in `worker/email.ts`.

| Player action | Email purpose | Relevant backend flow |
|---|---|---|
| Register with email/password | Verify ownership of the new email address | Registration calls the email-action issuance flow with kind `verify`. |
| Link email to an existing guest profile | Verify the address while preserving the existing player ID | Guest-upgrade flow issues a `verify` email action. |
| Resend verification | Send a fresh verification link | `/auth/verification/resend` issues a new verification action. |
| Forgot password | Send a password-reset link | `/auth/password/forgot` issues a `reset` email action. |
| Complete password reset | No new email is sent by this step | `/auth/password/reset` consumes the single-use reset token, changes the password, and revokes the account's sessions. |

The verification and reset action links expire after 30 minutes and can be used once. The backend stores token hashes, not raw action tokens. Password-reset requests use a generic public response so the endpoint does not reveal whether an email is registered.

## Current staging setup

The current staging configuration uses **Resend as primary**. The configured GitHub Actions secrets are:

- `RESEND_API_KEY` — secret; copied to the staging Worker as a Worker secret.
- `LUDO_EMAIL_FROM` — sender identity; injected into the staging Worker as a variable.

Brevo is deliberately not required yet. When the fallback is ready, add the GitHub Actions secret `BREVO_API_KEY`; the existing delivery code will attempt it after Resend fails. The staging workflow already supports forwarding that secret when it is present.

The workflow also sets `LUDO_APP_ORIGIN` from `LUDO_STAGING_PAGES_ORIGIN`. It is an origin setting, not a credential. Keep the staging app origin separate from production.

## Safe setup and verification

1. Create or use a Resend API key with the minimum permissions needed to send email.
2. Verify the sender address/domain in Resend and set `LUDO_EMAIL_FROM` to that exact approved sender identity, for example `LUDO LIVE <no-reply@your-verified-domain.example>`.
3. Add the two current values under the repository's GitHub Actions secrets. Do not expose their values in logs or source files.
4. Run the staging deployment workflow and confirm its provider-secret configuration step succeeds.
5. Test registration, guest email linking, verification resend, and password reset using test inboxes. Check actual inbox delivery and the staging-only link origin.
6. Later, when Brevo is configured, verify the same sender there and test the fallback by making the Resend attempt fail in a controlled staging test.

A successful secret-configuration step proves only that the credential was installed; it does not prove the sender is verified or that a real message reached an inbox. Do not claim email delivery is verified until an end-to-end inbox test succeeds.

## Security rules

- Keep API credentials in GitHub Actions secrets and Cloudflare Worker secrets only.
- Never put API credentials in `VITE_*` frontend variables, committed files, screenshots, issue comments, or chat.
- Never log provider keys, one-time tokens, or full verification/reset URLs.
- Use staging credentials and staging callback/origin settings for staging. Do not reuse production credentials there.
- If a key is exposed, revoke/rotate it with the provider and update the relevant secret store.
