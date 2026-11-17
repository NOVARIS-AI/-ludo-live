# Cloudflare production deployment

The deployment workflow is deliberately manual. A normal Git push only runs CI and never replaces the existing live AppDeploy game.

## One-time Cloudflare setup

1. Create a Cloudflare Pages project named `ludo-live` (the GitHub workflow deploys the built artifact to this project).
2. Create a Cloudflare API token with Workers Scripts: Edit, Workers KV/Queues/Durable Objects permissions required by the configured bindings, and Cloudflare Pages: Edit. Scope it to the account that owns the Pages project.
3. Add these GitHub Actions repository secrets:
   - `CLOUDFLARE_API_TOKEN`
   - `CLOUDFLARE_ACCOUNT_ID`
   - `LUDO_LIVE_PAGES_ORIGIN` — exact production Pages origin, e.g. `https://ludo-live.pages.dev`
   - `LUDO_LIVE_WORKER_API_URL` — deployed Worker HTTPS origin, e.g. `https://ludo-live-api.<your-subdomain>.workers.dev`
   - `LUDO_LIVE_REALTIME_URL` — the same Worker origin using `wss://` and ending in `/connect`
   - `LUDO_AUTH_READY` — set to the exact value `true` only after the account/security checks in step 5 pass
4. Confirm the Worker authentication and authorization gate is implemented and tested before enabling public traffic. The current Worker still accepts client-supplied player IDs on game routes; CORS is not authentication. Do not treat a successful deploy as proof that player accounts are secure.
5. Do not add `LUDO_AUTH_READY=true` until account registration, login, logout, expiry, cross-account isolation and room-action authorization have been tested against a deployed staging Worker. The code now provides email/password registration and login with PBKDF2 password hashing, random bearer sessions, 30-day expiry, login throttling and server-side player-ID binding; email ownership verification, password reset and abuse monitoring still need to be added before a public launch.
6. Open GitHub Actions → Deploy Ludo Live to Cloudflare → Run workflow only after the release gate is satisfied. The default deploys the Worker first, then Pages. Keep the existing AppDeploy app available until real-device multiplayer and account tests pass.

## Safety and rollback

- The workflow only runs on manual dispatch; pushes and pull requests cannot deploy production.
- The existing AppDeploy production URL is not changed by this workflow.
- Pages deployment requires the project to exist first.
- If Worker auth is not ready, do not run the production deployment workflow. Continue using CI's dry-run validation.
