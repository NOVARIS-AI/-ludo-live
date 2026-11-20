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
- Duplicate matchmaking joins return the original waiting queue entry.
- Blocked pairs are not matched; eligible pairs create one shared 1v1 room.
- Cancelled queue entries cannot be matched later, and waiting entries expire after 90 seconds.
- Matchmaking attempts are limited to five per player per minute.
- Account registration creates distinct player identities; bearer sessions resolve only to their owner.
- Expired sessions and logged-out sessions are rejected; incorrect passwords do not issue sessions.
- Private messages are stored for the two room members and broadcast on their individual inbox channels.
- Blocked accounts cannot exchange private messages.
- Call signalling is rejected until both players join the room call; call leave removes participation.
- Gameplay state changes create replay snapshots.

## Required staging checks before a public release

Run these with two separate browser profiles/devices against the staging Pages and Worker URLs:

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

Production remains locked until the staging checks above pass and account ownership verification, password reset, TURN relay, moderation operations and abuse monitoring are implemented and reviewed. A green unit-test run alone is not release approval.
