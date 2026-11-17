# Ludo Live — migration source archive

This repository preserves the last successful Ludo Live AppDeploy source snapshot (v13, `1794928744639`) and the incremental portability work.

## Current status

- Frontend HTTP calls use `src/lib/api.ts`.
- Frontend realtime connections use `src/lib/realtime.ts`.
- No AppDeploy client import remains in the frontend.
- The backend still imports `@appdeploy/sdk` and still depends on AppDeploy database services. The realtime adapter also needs its Cloudflare Worker endpoint.
- This is **not yet a standalone Cloudflare deployment**. The existing AppDeploy production app remains live while the replacement is prepared and tested.
- No API keys, environment values, user records or secrets are included.
- Future VELTRONIX NEXUS integrations remain disconnected.

## Environment

- `VITE_API_BASE_URL`: optional Worker API origin; empty means same-origin `/api`.
- `VITE_REALTIME_URL`: Worker WebSocket URL, for example a secure `wss://` endpoint. Realtime stays offline until this is configured.

See [MIGRATION_MAP.md](./MIGRATION_MAP.md) for routes, data collections, migration constraints and known source mismatches. Never commit secrets or production environment values.
