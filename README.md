# Ludo Live — standalone migration

This repository preserves the last successful AppDeploy source snapshot and the in-progress standalone Cloudflare migration.

## Migrated modules
- React/Vite frontend with a fetch-based API client and browser WebSocket adapter; no frontend AppDeploy SDK imports remain.
- Installable PWA foundation with app manifest, original vector icon, safe offline app-shell caching, and Cloudflare Pages SPA fallback/security headers.
- Responsive game presentation foundation with a landscape-first match HUD, scalable board, dice controls, compact mobile top bar, and slide-over chat/crew/hangout panels.
- Cloudflare Worker API with CORS and health-check routes.
- `LudoRoom` Durable Object: room persistence, serialized actions, game rules, computer turns, public/private chat with rate limits and block checks, call signaling and bounded replay snapshots recorded on game-state changes.
- `RealtimeHub` Durable Object: WebSocket connections, subscriptions and entity-update broadcasts.
- `MatchmakingLobby` Durable Object: quick 1v1 pairing, status polling, cancellation, queue expiry, blocked-player avoidance and atomically enforced per-account retry throttling.
- `AppData` Durable Object: guest-first player identity, optional email/password linking, tournament creation/join/start/result reporting, global leaderboard, player summaries, block/report records, and a disconnected integration manifest.
- Completed games are copied into persistent match-result storage; replay snapshots remain available through the room replay endpoint.

## Release status and remaining requirements
The standalone app now opens with a player-name-only guest entry: the server creates a unique player ID and a 30-day bearer session, so players can enter rooms, play matches and use normal multiplayer features without an email or password. Players can optionally link an email and password later; the same player ID and match history are retained. Tournament creation is restricted at the Worker API boundary to email-linked profiles. Existing email/password accounts remain supported. Passwords are hashed with PBKDF2, sessions expire, login attempts are throttled, room actions and matchmaking identity are authenticated, and WebSocket tickets are short-lived and single-use. Public/private room chat has server-side rate limits. Call signaling subscriptions are restricted to players who have joined that room's call, and realtime subscription changes are bound to the authenticated socket owner.

This is still **staging-ready work, not a production launch**. Email ownership verification and password reset are implemented in the staging branch using Resend as the primary sender and Brevo as automatic fallback. New email registrations remain in guest privileges until their one-time verification link is used; guest email upgrades preserve the player ID and stay guest-only until verification. Password-reset requests use generic responses, single-use 30-minute tokens stored as hashes, rate limits, and session revocation after a successful reset. Delivery remains inactive until the staging Worker is configured with provider API keys, a verified sender, and the staging app origin. Existing legacy accounts without an explicit `emailVerified: false` flag remain compatible; newly created accounts must verify. A TURN relay is still required for reliable WebRTC calls across restrictive networks. Reports are stored, but a staffed moderation and appeal workflow is not included. Friend requests resolve both player names from server-owned accounts, reject unknown player IDs, support reciprocal auto-accept, and are rate-limited; players add friends using only a player ID. Blocking is persisted and enforced for friend requests, private-message send/history, room joins and matchmaking; blocked public-chat messages are filtered from the game chat UI. A 120-second server-side reconnect grace period now preserves a disconnected player's seat; reconnecting clears the expiry alarm, while players who do not return are removed when the Durable Object alarm fires. Automated end-to-end multiplayer tests, abuse monitoring, accessibility review and real-device QA remain required.

The AppDeploy production app remains live and untouched. Cloudflare deployment is manual and requires account secrets and staging validation. No secrets, environment values or user records are committed. Cross-app integrations remain disconnected by design.

## Cloudflare Pages and Worker setup

1. Create a Cloudflare Pages project connected to this GitHub repository; build command `npm run build`, output directory `dist`.
2. Create a Cloudflare Worker using `wrangler.toml` and deploy `worker/index.ts` only after configuring the production Pages origin in the Worker `ALLOWED_ORIGIN` variable.
3. Set the Pages build variable `VITE_API_BASE_URL` to the deployed Worker HTTPS origin and `VITE_REALTIME_URL` to its `wss://` `/connect` endpoint.
4. Keep preview origins out of the production allowlist unless they are intentionally trusted. The checked-in localhost value is for local development only.
5. Configure and verify the account system, exact origin allowlist, session expiry/revocation, room authorization and realtime ticket flow. CORS is not authentication.
6. Verify room creation/join/turns, quick matchmaking and its retry limit, a dropped WebSocket followed by reconnect before 120 seconds, expiry after 120 seconds, tournaments, chat, moderation and replay with at least two real devices before switching away from the existing AppDeploy app.

The CI workflow builds the frontend, runs TypeScript checks, dry-runs the Worker bundle and retains the Pages `dist/` artifact. It does not deploy automatically. A separate manual workflow is prepared in `.github/workflows/cloudflare-deploy.yml`; it requires Cloudflare secrets and an explicit `LUDO_AUTH_READY=true` release gate. See `CLOUDFLARE_DEPLOYMENT.md` for the setup and rollout sequence.

## Local development
1. Install Node.js 22 or newer and run `npm install`.
2. Start Vite with `npm run dev`.
3. Start the Worker locally with `npm run dev:worker`.
4. Set `VITE_API_BASE_URL` to the Worker HTTP origin.
5. `VITE_REALTIME_URL` is optional when `VITE_API_BASE_URL` is set; the app derives the WebSocket `/connect` URL automatically.
6. Run `npm run build`, `npm run typecheck`, and `npx wrangler deploy --dry-run` before deployment.

## Cloudflare resources
Wrangler declares SQLite-backed Durable Object classes `LudoRoom`, `RealtimeHub`, `MatchmakingLobby`, and `AppData`. Deployment requires Cloudflare account authorization. No deployment has been performed.

## Browser security configuration
The Worker intentionally does not use wildcard CORS. The checked-in Wrangler default permits only local Vite development at `http://localhost:5173`. Before publishing the Pages frontend, set the Worker `ALLOWED_ORIGIN` variable to the exact deployed Pages origin (comma-separated exact origins only if multiple frontends are intentionally supported). WebSocket connections enforce the same allowlist. A production deployment with the local-only default will correctly reject the Pages site until this value is changed.


## Staging email delivery configuration

The Worker supports two independent transactional email providers:
- **Resend** is attempted first.
- **Brevo** is attempted only if Resend is not configured, throws, or returns a non-success response.

Configure these values on the **staging Worker only** (Cloudflare Dashboard → Workers & Pages → `ludo-live-api-staging` → Settings → Variables and Secrets):

- Secret `RESEND_API_KEY`: Resend API key.
- Secret `BREVO_API_KEY`: Brevo API key.
- Variable `LUDO_EMAIL_FROM`: sender identity verified with both providers, e.g. `LUDO LIVE <no-reply@your-verified-domain.example>`.
- Variable `LUDO_APP_ORIGIN`: exact staging Pages origin, e.g. `https://ludo-live-staging.pages.dev` (use the actual staging origin, not production).

Do not put provider keys in Git, frontend variables, chat messages, or the repository. Verify the sender/domain with both providers before testing. If neither provider can send, account linking remains guest-only and registration reports a delivery error; no unverified account receives tournament-hosting privileges.

The email endpoints are `/api/auth/verify-email`, `/api/auth/verification/resend`, `/api/auth/password/forgot`, and `/api/auth/password/reset`. Verification and reset links expire after 30 minutes and are single-use. Resend and forgot-password requests are rate-limited and do not disclose whether an address is registered.


## Email credential reference

See [EMAIL_KEYS_REFERENCE.md](docs/EMAIL_KEYS_REFERENCE.md) for the purpose of every email credential/configuration value, the player-facing features that use it, safe setup steps, and staging verification requirements. The current staging setup requires Resend plus a verified sender; Brevo is an optional fallback and is not required until it is configured.
