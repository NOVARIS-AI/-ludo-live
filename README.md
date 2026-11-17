# Ludo Live — migration source archive

The repository contains the last successful AppDeploy source snapshot and the Cloudflare migration.

## Cloudflare migration stage
- `worker/index.ts` provides room Durable Objects and a realtime WebSocket hub.
- Implemented API routes: room create, computer room create, room fetch, spectate, join, start, roll, move, pass, chat, call join/leave and leave; plus realtime subscribe/unsubscribe.
- Matchmaking, tournaments, leaderboard, friends, progression, cosmetics, report/block moderation and replay persistence are not yet migrated.
- The original AppDeploy backend remains as historical source. Production has not been switched.

## Local setup
- `npm install`
- `npm run dev` for Vite
- `npm run dev:worker` for Wrangler
- Set `VITE_API_BASE_URL` to the Worker HTTP origin and `VITE_REALTIME_URL` to the Worker WebSocket `/connect` endpoint.
- Configure a specific Pages origin instead of the wildcard CORS value before deployment.

This is an in-progress migration, not a production-ready deployment. Authentication, rate limiting, abuse protection, and the remaining D1-backed features must be completed and tested first. Do not commit secrets or user records. Integrations remain disconnected.
