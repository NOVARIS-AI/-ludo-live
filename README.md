# Ludo Live — standalone migration

This repository preserves the last successful AppDeploy source snapshot and the in-progress standalone Cloudflare migration.

## Migrated modules
- React/Vite frontend with a fetch-based API client and browser WebSocket adapter; no frontend AppDeploy SDK imports remain.
- Installable PWA foundation with app manifest, original vector icon, safe offline app-shell caching, and Cloudflare Pages SPA fallback/security headers.
- Responsive game presentation foundation with a landscape-first match HUD, scalable board, dice controls, compact mobile top bar, and slide-over chat/crew/hangout panels.
- Cloudflare Worker API with CORS and health-check routes.
- `LudoRoom` Durable Object: room persistence, serialized actions, game rules, computer turns, public/private chat, call signaling and bounded replay snapshots.
- `RealtimeHub` Durable Object: WebSocket connections, subscriptions and entity-update broadcasts.
- `MatchmakingLobby` Durable Object: quick 1v1 pairing, status polling, cancellation and queue expiry.
- `AppData` Durable Object: tournament creation/join/start/result reporting, global leaderboard, player summaries, block/report records, and a disconnected integration manifest.
- Completed games are copied into persistent match-result storage; replay snapshots remain available through the room replay endpoint.

## Important limitations
This is **not production-ready and has not been deployed**. The current player ID is a client-generated guest identifier, not an authenticated identity. Do not expose this Worker publicly until authentication/authorization, rate limits, abuse controls and an exact allowed origin are configured. Reports are stored for future moderation; a staffed moderation workflow is not included. Block records are persisted and returned to the client, but are not a complete safety system. WebRTC signaling is present, but a TURN relay is still needed for reliable calls across restrictive networks.

The UI styles and layout have been added in source, but device-by-device visual QA and end-to-end multiplayer tests are still required. The AppDeploy production app remains live and untouched while this replacement is built and tested. Original AppDeploy backend files remain as historical reference. No secrets, environment values or user records are committed. Cross-app integrations remain disconnected.

## Cloudflare Pages and Worker setup

1. Create a Cloudflare Pages project connected to this GitHub repository; build command `npm run build`, output directory `dist`.
2. Create a Cloudflare Worker using `wrangler.toml` and deploy `worker/index.ts` only after configuring the production Pages origin in the Worker `ALLOWED_ORIGIN` variable.
3. Set the Pages build variable `VITE_API_BASE_URL` to the deployed Worker HTTPS origin and `VITE_REALTIME_URL` to its `wss://` `/connect` endpoint.
4. Keep preview origins out of the production allowlist unless they are intentionally trusted. The checked-in localhost value is for local development only.
5. Configure a durable guest/player identity and server-side authorization before public release. Current player IDs are client-generated and are not authenticated; CORS is not authentication.
6. Verify room creation/join/turns, quick matchmaking, reconnect behavior, tournaments, chat, moderation and replay with at least two real devices before switching away from the existing AppDeploy app.

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
