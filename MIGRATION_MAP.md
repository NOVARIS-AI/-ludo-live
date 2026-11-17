# Ludo Live migration map

Baseline: AppDeploy snapshot v13, `1794928744639`.
Original source archive commit: `335edf0`.

## Frontend platform coupling

- HTTP calls use the portable fetch adapter at `src/lib/api.ts`.
- WebSocket calls use the browser adapter at `src/lib/realtime.ts`; no AppDeploy client import remains in the frontend.
- Configure `VITE_API_BASE_URL` for a separate Worker API and `VITE_REALTIME_URL` for its WebSocket endpoint. Leave the API base empty only when the API shares the Pages origin.
- The realtime Worker must accept a `connection_id` query parameter and preserve the existing `entity.update` event envelope. The adapter provides client-side connection IDs; the server must validate and scope subscriptions.

## API route inventory

### Rooms and gameplay
- `POST /api/rooms`, `POST /api/rooms/computer`
- `GET /api/rooms/:code`, `POST /api/rooms/:code/join`
- `POST /api/rooms/:code/start`, `roll`, `move`, `pass`, `bot/turn`, `leave`
- `POST /api/rooms/:code/chat`, `private-chat`, `private-chat/list`
- `POST /api/rooms/:code/call/join`, `call/leave`, `signal`
- `POST /api/matchmaking/join`, `matchmaking/status`, `matchmaking/cancel`

### Competition and player data
- `GET /api/tournaments`, `POST /api/tournaments`
- `POST /api/tournaments/:id/join`, `leave`, `start`, `report-result`
- `GET /api/leaderboard`, `GET /api/players/:playerId/summary`
- `GET /api/rooms/:code/spectate`, `GET /api/rooms/:code/replay`
- `GET /api/players/:playerId/progression`, `POST /api/players/:playerId/cosmetics/equip`
- `GET /api/players/:playerId/friends`, `POST /api/friends/request`, `POST /api/friends/:id/accept`, `decline`
- `GET /api/season/leaderboard`, `POST /api/safety/report`
- `GET /api/integrations/manifest`

### Known frontend/backend mismatch
- The frontend requests `GET /api/players/:playerId/blocked` and `POST /api/safety/block`.
- Those routes are not present in the last successful v13 backend snapshot. Blocking is therefore not functional in that baseline; do not rely on the UI control until a real block-list implementation is added.

## Data collections observed in the source

- `ludo_rooms`: active rooms and matchmaking queue records (shared collection).
- `ludo_results`: completed match records and replay snapshots.
- `ludo_tournaments`: tournament brackets and participants.
- `ludo_profiles`: equipped cosmetic state.
- `ludo_friends`: friend requests and accepted relationships.
- `ludo_reports`: player reports.
- `entity_subscriptions`: realtime connection subscriptions.
- Per-room private chat collections are generated as `ludo_dm_<room>_<player-pair>`.

## Migration constraints

1. Keep AppDeploy production live until the replacement passes gameplay and multiplayer tests.
2. Do not deploy to AppDeploy while its usage-limit block remains active.
3. Preserve compare-and-swap room updates: the current backend uses room `version` checks to prevent simultaneous moves from overwriting each other.
4. Port database operations and realtime delivery before claiming multiplayer parity. A static Pages build alone is not a working multiplayer migration.
5. Keep integrations disconnected. The manifest is informational only.
6. Do not commit credentials, user data or environment values.

## Next backend work

Implement a Cloudflare Worker API with a transactional room store (Durable Objects are the leading fit for per-room serialized state), then port the route handlers. Add a separate realtime signaling channel for room updates, private chat and WebRTC signaling. Preserve idempotency for result writes and matchmaking.
