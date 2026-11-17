# Migration status

## Implemented in this stage
- Cloudflare Worker entry point.
- SQLite-backed Durable Object room storage and serialized room actions.
- RealtimeHub Durable Object with WebSocket connections, entity subscriptions and broadcasts.
- Core room routes: create, create computer room, fetch, spectate, join, start, roll, move, pass, chat, call join/leave and leave.
- Explicit 503 response for matchmaking and 501 for routes not yet migrated.

## Remaining
- Matchmaking lobby and atomic queue claims.
- D1 persistence for tournaments, leaderboard, player profiles, friends, reports, results and replay history.
- Private chat and WebRTC signaling relay.
- Authentication, rate limits, input validation hardening and moderation.
- Frontend layout and full multiplayer test suite.
- Replace wildcard CORS with the exact Pages origin and configure Worker environment variables.

Keep the AppDeploy production app online until the replacement has passed functional, security and multiplayer tests. No production deployment has been made.
