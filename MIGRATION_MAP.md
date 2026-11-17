# Migration status

## Implemented in source
- Frontend HTTP and WebSocket adapters; no remaining `@appdeploy/client` imports in the frontend.
- Landscape-first responsive game HUD and responsive board/panels styling.
- Cloudflare Worker entry point, CORS and health-check.
- `LudoRoom`: per-room storage, serialized room actions, Ludo rules, bot turns, chat, call signaling, leave and spectate.
- `RealtimeHub`: WebSocket upgrade, subscriptions and entity-update broadcasts.
- `MatchmakingLobby`: quick 1v1 queue, status, cancel and 90-second expiry.
- `AppData`: tournament CRUD/start/result reporting, leaderboard, player summaries, blocked-player list, reports, and disconnected integration manifest.
- Finished match result persistence and bounded room replay snapshots.

## Still required before public production
- Authenticated player identity and authorization for every room/data action.
- Rate limits, anti-abuse controls, report review/moderation workflow and exact Pages-origin CORS.
- TURN relay for dependable voice/video across restrictive networks.
- Friends, cosmetics/progression, season leaderboard and richer persistent match-history UX.
- End-to-end tests for room lifecycle, matchmaking races, reconnects, replay integrity, team rules, chat and hangout.
- Visual QA on real Android phones, tablets and desktop; adjust board sizing and HUD after screenshots.
- Cloudflare Pages/Worker configuration, environment values and a verified deployment.

## Production gate
Keep the existing AppDeploy app live until the replacement passes the build, Worker dry-run, security review and multiplayer/device tests. No Cloudflare deployment has been made. AppDeploy remains untouched.
