# Ludo Live staging test plan

Automated tests run with `npm test` and are part of GitHub Actions CI. The current suite exercises the room Durable Object contract using an in-memory storage/namespace harness; it does not replace real Cloudflare Durable Object integration tests.

## Automated coverage

- Duplicate room-code creation is rejected without overwriting the room.
- Only the host can start a match.
- A player cannot roll out of turn or roll again before resolving the previous roll.
- Token selection is restricted to the four valid token slots.
- A player cannot move before rolling or leave the yard without a six.
- Passing is rejected when a legal move exists and accepted when no token can move.
- Three consecutive sixes correctly forfeit the turn.
- Captures return opponents to the yard, while safe squares prevent captures.
- Reconnection inside the 120-second grace window clears the expiry alarm.
- Expired disconnected players are removed and host ownership is reassigned.
- Room chat burst limits return HTTP 429 after the configured threshold.
- Duplicate matchmaking joins return the original waiting queue entry, including simultaneous retries from the same account.
- Concurrent joins from two different accounts are serialized and create exactly one shared 1v1 room.
- Blocked pairs are not matched; eligible pairs create one shared 1v1 room.
- Cancelled queue entries cannot be matched later, and waiting entries expire after 90 seconds.
- Matchmaking attempts are limited to five per player per minute.
- Account registration creates distinct player identities; bearer sessions resolve only to their owner.
- Expired sessions and logged-out sessions are rejected; incorrect passwords do not issue sessions.
- Private messages are stored for the two room members and broadcast on their individual inbox channels.
- Blocked accounts cannot exchange private messages.
- Call signalling is rejected until both players join the room call; call leave removes participation.
- Gameplay state changes create replay snapshots.
- Realtime broadcasts reach only sockets subscribed to the exact entity; duplicate subscriptions are deduplicated and unsubscribe stops delivery.

- Worker API boundary tests reject missing bearer sessions on protected routes.
- Guest entry creates a server-issued player ID and 30-day bearer session using only a display name.
- Email linking upgrades the same guest player ID; weak passwords and duplicate email addresses are rejected.
- Friend requests accept only real player IDs, resolve display names from stored accounts, reject unknown IDs, auto-accept reciprocal requests and enforce per-player request rate limits.
- Guest sessions can use normal multiplayer APIs but cannot create tournaments until an email account is linked.
- Private inbox subscriptions cannot target another account, and hub identity is taken from the authenticated session.
- Call-signal subscriptions require both room membership and active call participation.
- Room creation overwrites spoofed player IDs and display names with session-owned identity.
- Replay endpoints hide in-progress matches and return snapshots only after completion.

The automated suite currently contains 55 tests across room gameplay, matchmaking/authentication (including concurrent queue operations, guest identity creation, verified email linking, single-use password reset and session revocation), realtime hub delivery and authenticated Worker API boundaries. Matchmaking queue mutations are serialized within the lobby Durable Object to prevent overlapping requests from pairing or duplicating queue entries. These are authored tests; the latest CI run must still be checked after each implementation commit, and deployed staging behavior must be verified separately.

## Automated deployed staging integration

After the staging Worker deploys, the workflow runs `scripts/staging-multiplayer-smoke.mjs` against the configured staging Worker API and Pages origin. It creates two separate temporary test accounts, verifies distinct authenticated identities, creates and joins a real 1v1 Durable Object room, checks host-only start, starts a match, rolls, rejects an invalid token selection, performs a legal move or pass, rejects an out-of-turn roll, verifies the room version advances, and confirms unauthenticated room reads are rejected. Staging Pages deployment is gated on this integration test passing.

The integration script logs out both temporary accounts and attempts to remove both players from the test room. It uses generated staging-only email addresses and does not touch production.

The workflow also runs `scripts/staging-realtime-smoke.mjs` after installing the project dependencies. This second deployed integration test creates two independent accounts, obtains short-lived single-use realtime tickets, opens two authenticated WebSocket connections with the staging Pages Origin, subscribes both connections to the same room, starts the room and requires both sockets to receive the room update. The realtime-ticket endpoint's bearer-header parsing is covered by a Worker API regression test; the deployed WebSocket test additionally validates ticket issuance and consumption end to end.

## Required staging checks before a public release

The automated Worker integration above exercises two independent accounts against real staging Durable Objects. Also run these client/UI checks with two separate browser profiles/devices against the staging Pages and Worker URLs:

1. Register two different accounts; verify each receives a distinct player identity.
2. Sign in on both devices and create/join a friends room using its invite code.
3. Confirm spectators cannot issue player actions and a non-host cannot start the match.
4. Play a complete match, including a six, a legal capture, an invalid move, a no-move pass and a win.
5. Disconnect the active player, reconnect before 120 seconds, and confirm the same seat and turn are restored.
6. Leave one player disconnected beyond 120 seconds; confirm removal, host reassignment and continued play.
7. Start simultaneous matchmaking searches from two accounts; confirm exactly one shared 1v1 room is created and both players receive the same room code.
8. Cancel a waiting queue entry and verify it cannot later be matched.
9. Verify a blocked pair cannot match or exchange private messages; verify public chat filters blocked senders in the client.
10. Verify chat and matchmaking rate limits, session expiry, logout, and cross-account room-action isolation.
11. Test private messages, room chat, call signalling, reconnects and replay playback on real staging Worker Durable Objects; confirm the replay API returns the completed match timeline.
12. Inspect Worker logs for uncaught errors and confirm no production URL or production namespace was touched.

## Release gate

Production remains locked until the staging checks above pass and staging email-provider secrets are configured and real verification/reset emails are tested with both providers, TURN relay, moderation operations and abuse monitoring are implemented and reviewed. A green unit-test run alone is not release approval.


## Email security staging checks

1. Configure `RESEND_API_KEY`, `BREVO_API_KEY`, `LUDO_EMAIL_FROM` and `LUDO_APP_ORIGIN` on the staging Worker only; verify the sender with both providers.
2. Verify Resend receives the first attempt and Brevo is used when Resend is deliberately unavailable or returns a non-success response.
3. Register a new email account and confirm it remains guest-only until the email link is used.
4. Upgrade a guest profile and verify the same player ID remains in place before and after email verification.
5. Confirm verification links expire after 30 minutes and cannot be reused.
6. Request a password reset for both an existing and unknown address; confirm the public response does not reveal account existence.
7. Complete a password reset, confirm the link is single-use, and verify all sessions for that account are invalidated.
8. Confirm unverified accounts cannot create tournaments at the Worker boundary.
9. Confirm links point only to the staging Pages origin and provider tokens/URLs never appear in Worker logs.
