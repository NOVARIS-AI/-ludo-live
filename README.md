# Ludo Live — migration source archive

This repository contains the last successful Ludo Live AppDeploy source snapshot (v13, snapshot `1794928744639`) and the incremental portability work.

## Current status

- The original v13 source is preserved in Git history.
- Frontend HTTP calls now go through a portable fetch client in `src/lib/api.ts`.
- The AppDeploy WebSocket client and all AppDeploy backend SDK/database dependencies remain. This repository is **not yet a standalone Cloudflare deployment**.
- The AppDeploy production app remains the live version while migration work is prepared and tested.
- No API keys, environment values, user records, or secrets are included.
- Future VELTRONIX NEXUS integrations remain disconnected.

## Local API configuration

- Same-origin API: leave `VITE_API_BASE_URL` unset.
- Separate API host: set `VITE_API_BASE_URL` to the Worker API origin. The Worker must enable CORS for the Pages origin.

## Migration notes

See [MIGRATION_MAP.md](./MIGRATION_MAP.md) for the route inventory, data collections, known frontend/backend mismatch and backend migration constraints.

Never commit secrets or production environment values. Use local `.env` files excluded by `.gitignore` and Cloudflare secret bindings for deployment.
