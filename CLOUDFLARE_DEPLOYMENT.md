# Cloudflare production deployment

The deployment workflow is deliberately manual. A normal Git push only runs CI and never replaces the existing live AppDeploy game.

## One-time Cloudflare setup

Create two Cloudflare Pages projects: `ludo-live-staging` and `ludo-live`. Staging is the first deployment target; production remains separate.

Create a Cloudflare API token scoped to the account with permission to edit Workers (including Durable Objects) and Pages. Add these GitHub Actions repository secrets:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
- `LUDO_STAGING_PAGES_ORIGIN` — exact staging Pages origin, e.g. `https://ludo-live-staging.pages.dev`
- `LUDO_STAGING_WORKER_API_URL` — staging Worker HTTPS origin, e.g. `https://ludo-live-api-staging.<your-subdomain>.workers.dev`
- `LUDO_STAGING_REALTIME_URL` — staging Worker WSS origin ending in `/connect`
- `LUDO_LIVE_PAGES_ORIGIN` — exact production Pages origin, e.g. `https://ludo-live.pages.dev`
- `LUDO_LIVE_WORKER_API_URL` — production Worker HTTPS origin, e.g. `https://ludo-live-api.<your-subdomain>.workers.dev`
- `LUDO_LIVE_REALTIME_URL` — production Worker WSS origin ending in `/connect`
- `LUDO_AUTH_READY` — keep unset until staging account/security checks pass; only then set it to the exact value `true` to unlock production

Open GitHub Actions → Deploy Ludo Live to Cloudflare → Run workflow. Select **staging** first. The workflow deploys the Worker and then Pages. The Worker names and Pages projects are isolated between staging and production.

The code now provides email/password registration and login with PBKDF2 password hashing, random bearer sessions, 30-day expiry, login throttling and server-side player-ID binding. Before production, test registration, login, logout, expiry, cross-account isolation, room-action authorization, reconnects and two-device multiplayer against staging. Email ownership verification, password reset and abuse monitoring still need to be added before a public launch.

## Safety and rollback

- The workflow only runs on manual dispatch; pushes and pull requests cannot deploy.
- Staging and production use separate Worker names and Pages projects.
- Production deployment is blocked unless `LUDO_AUTH_READY=true` is set after staging validation.
- The existing AppDeploy production URL is not changed by this workflow.
- Pages deployment requires the project to exist first.
- If Worker auth is not ready, do not run the production deployment workflow. Continue using CI's dry-run validation.
