# Ludo Live — migration source archive

This repository preserves the last successful AppDeploy source snapshot and the in-progress Cloudflare migration.

## Implemented migration modules
- Frontend HTTP adapter: `src/lib/api.ts`.
- Frontend realtime WebSocket adapter: `src/lib/realtime.ts`.
- Cloudflare Worker API: `worker/index.ts`.
- `LudoRoom` Durable Object stores each room and serializes game actions.
- `RealtimeHub` Durable Object manages WebSocket connections, entity subscriptions and broadcasts.
- Room create, computer room create, room fetch, spectate, join, start, roll, move, pass, bot turn, public chat, private chat, call join/leave, WebRTC signaling and leave are implemented in the Worker.
- The Worker returns explicit not-yet-migrated responses for matchmaking and the D1-backed tournament/profile/social/history features.

## Important limitations
This is **not production-ready and has not been deployed**. Player identity is currently supplied by the client and is not authenticated; do not expose this Worker publicly until authentication, authorization, rate limits, abuse controls and origin restrictions are completed. WebRTC signaling is implemented, but a TURN relay is still needed for reliable calls across restrictive networks. Matchmaking, tournaments, global rankings, player profiles, friends, moderation persistence and replay history still need their D1/lobby migration.

The AppDeploy production app remains the live version while this replacement is built and tested. The original AppDeploy backend files remain in the repository as historical source. No secrets, environment values or user records are committed. Cross-app integrations remain disconnected.

## Local development
1. Install Node.js 22 or newer and run `npm install`.
2. Start Vite with `npm run dev`.
3. Start the Worker locally with `npm run dev:worker`.
4. Set `VITE_API_BASE_URL` to the Worker HTTP origin.
5. Set `VITE_REALTIME_URL` to the Worker WebSocket URL ending in `/connect`.
6. Before any deployment, replace wildcard CORS with the exact Pages origin and add authentication and rate limiting.

## Cloudflare resources
Wrangler declares SQLite-backed Durable Object classes `LudoRoom` and `RealtimeHub`. Deployment requires Cloudflare account authorization. No deployment has been performed.
