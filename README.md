# Ludo Live — migration source archive

This repository contains the last successful Ludo Live AppDeploy source snapshot (v13, snapshot 1794928744639) copied for migration planning.

## Important status

- This is a source backup, **not yet a standalone deployable migration**.
- The original frontend imports `@appdeploy/client`; the backend imports `@appdeploy/sdk`. Those platform-specific dependencies and their database/realtime services still need to be replaced.
- Do not deploy this snapshot directly to Cloudflare Pages/Workers.
- The existing AppDeploy production app remains the live version while migration work is prepared and tested.
- No API keys, environment values, user records, or secrets are included in this archive.
- Future VELTRONIX NEXUS integrations remain disconnected; only the app's integration manifest foundation is retained.

## Source baseline

- Snapshot: v13
- AppDeploy app id: `ludo-live-36f4jn`
- Captured files: 17
- Source characters: 54889

## Planned migration stages

1. Replace AppDeploy client API calls with a portable typed HTTP client.
2. Port backend routes and data operations to Cloudflare Workers + a durable database/realtime approach.
3. Preserve room state, matchmaking, tournaments, player features, chat and spectator behavior.
4. Correct the immersive responsive gameplay UI (landscape-first mobile, desktop adaptive).
5. Add automated checks and validate a preview before any production cutover.

Never commit secrets or production environment values. Use local `.env` files excluded by `.gitignore` and Cloudflare secret bindings for deployment.
