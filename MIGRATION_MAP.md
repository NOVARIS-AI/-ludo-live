# Migration status

## Implemented
- Frontend HTTP and WebSocket adapters no longer depend on the AppDeploy client.
- Cloudflare Worker entry point with CORS and health-check routes.
- Per-room Durable Object storage and serialized room actions.
- Realtime Durable Object with WebSocket upgrade, subscriptions and entity update broadcasts.
- Room create/join/start/roll/move/pass/bot-turn/chat/private-chat/call-join/call-leave/call-signal/leave and spectate routes.

## Not yet migrated
- Atomic quick-match lobby and matchmaking status/cancel.
- D1-backed tournaments, global leaderboard, player profiles, progression, cosmetics, friends, reports, blocks, match result persistence and replay history.
- Authentication, identity verification, rate limits, anti-abuse and full moderation.
- TURN relay for reliable voice/video calls.
- Full gameplay UI adaptation and end-to-end multiplayer tests.

## Production gate
Do not switch the live AppDeploy app until the Worker and frontend pass build, security and multiplayer tests. Configure an exact allowed origin, authenticate player identities, protect room actions, and set real Cloudflare environment values before public deployment. No production deployment has been made.
