import { randomUUID } from "node:crypto";

const workerBase = (process.env.LUDO_STAGING_WORKER_API_URL || "").replace(/\/+$/, "");
const pagesOrigin = process.env.LUDO_STAGING_PAGES_ORIGIN || "";
if (!workerBase || !pagesOrigin) {
  throw new Error("LUDO_STAGING_WORKER_API_URL and LUDO_STAGING_PAGES_ORIGIN are required.");
}

async function request(path, { token, body, method = body === undefined ? "GET" : "POST" } = {}) {
  const response = await fetch(workerBase + path, {
    method,
    headers: {
      Accept: "application/json",
      Origin: pagesOrigin,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const raw = await response.text();
  let data = {};
  try { data = raw ? JSON.parse(raw) : {}; } catch { data = { message: raw }; }
  return { status: response.status, data };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function expectStatus(result, status, label) {
  assert(result.status === status, `${label}: expected HTTP ${status}, received ${result.status}: ${result.data.error || result.data.message || ""}`);
}

async function main() {
  const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  const accounts = [
    { name: "Staging Player One" },
    { name: "Staging Player Two" },
  ];
  const sessions = [];
  let roomCode = "";

  try {
    for (const account of accounts) {
      const result = await request("/api/auth/guest", { body: { name: account.name } });
      expectStatus(result, 200, `Create guest session for ${account.name}`);
      assert(result.data.user?.id && result.data.token, "Registration did not return a user and bearer token.");
      sessions.push({ ...account, id: result.data.user.id, token: result.data.token });
    }
    assert(sessions[0].id !== sessions[1].id, "Two staging guest sessions unexpectedly share one player identity.");

    for (const session of sessions) {
      const me = await request("/api/auth/me", { token: session.token });
      expectStatus(me, 200, `Verify session for ${session.name}`);
      assert(me.data.user?.id === session.id, "Bearer session resolved to the wrong player.");
    }

    const created = await request("/api/rooms", { token: sessions[0].token, body: { gameMode: "one-v-one" } });
    expectStatus(created, 200, "Create 1v1 room");
    roomCode = created.data.room?.code;
    assert(typeof roomCode === "string" && /^[A-Z0-9]{6}$/.test(roomCode), "Room creation did not return a valid room code.");

    const joined = await request(`/api/rooms/${roomCode}/join`, { token: sessions[1].token, body: {} });
    expectStatus(joined, 200, "Second player joins room");
    assert(joined.data.room?.players?.length === 2, "Room does not contain both authenticated players.");
    assert(joined.data.room.players.some(player => player.id === sessions[0].id), "Host identity is missing from the room.");
    assert(joined.data.room.players.some(player => player.id === sessions[1].id), "Joining player identity is missing from the room.");

    const nonHostStart = await request(`/api/rooms/${roomCode}/start`, { token: sessions[1].token, body: {} });
    expectStatus(nonHostStart, 403, "Reject non-host start");

    const started = await request(`/api/rooms/${roomCode}/start`, { token: sessions[0].token, body: {} });
    expectStatus(started, 200, "Host starts 1v1 match");
    assert(started.data.room?.status === "playing", "Room did not enter playing state.");

    const beforeRoll = started.data.room;
    const active = beforeRoll.players[beforeRoll.state.currentTurnIndex];
    const activeSession = sessions.find(session => session.id === active.id);
    const inactiveSession = sessions.find(session => session.id !== active.id);
    assert(activeSession && inactiveSession, "Active turn does not belong to either authenticated player.");

    const rolled = await request(`/api/rooms/${roomCode}/roll`, { token: activeSession.token, body: {} });
    expectStatus(rolled, 200, "Active player rolls dice");
    const dice = rolled.data.room?.state?.dice;
    assert(Number.isInteger(dice) && dice >= 1 && dice <= 6, "Roll did not produce a valid die value.");

    const invalidMove = await request(`/api/rooms/${roomCode}/move`, {
      token: activeSession.token,
      body: { tokenIndex: 99 },
    });
    expectStatus(invalidMove, 400, "Reject invalid token selection");

    const positions = rolled.data.room.state.tokens[activeSession.id] || [-1, -1, -1, -1];
    const legalToken = positions.findIndex(position => position === -1 ? dice === 6 : position + dice <= 57);
    if (legalToken < 0) {
      const passed = await request(`/api/rooms/${roomCode}/pass`, { token: activeSession.token, body: {} });
      expectStatus(passed, 200, "Active player passes when no token can move");
    } else {
      const moved = await request(`/api/rooms/${roomCode}/move`, {
        token: activeSession.token,
        body: { tokenIndex: legalToken },
      });
      expectStatus(moved, 200, "Active player makes a legal move");
    }

    const room = await request(`/api/rooms/${roomCode}`, { token: sessions[0].token });
    expectStatus(room, 200, "Read room after two-player actions");
    const currentPlayerId = room.data.room?.players?.[room.data.room?.state?.currentTurnIndex]?.id;
    const wrongTurnSession = sessions.find(session => session.id !== currentPlayerId);
    assert(wrongTurnSession, "Could not identify the player who is out of turn.");
    const wrongTurn = await request(`/api/rooms/${roomCode}/roll`, { token: wrongTurnSession.token, body: {} });
    expectStatus(wrongTurn, 403, "Reject out-of-turn roll");
    assert(room.data.room?.version > beforeRoll.version, "Room version did not advance after gameplay actions.");
    assert(room.data.room?.players?.length === 2, "A player was lost during the match.");

    const unauthenticated = await request(`/api/rooms/${roomCode}`);
    expectStatus(unauthenticated, 401, "Reject unauthenticated room read");

    console.log("STAGING MULTIPLAYER INTEGRATION PASSED");
    console.log(`- Two independent guest sessions authenticated: ${sessions.map(s => s.id).join(", ")}`);
    console.log(`- Shared real Durable Object room created and joined: ${roomCode}`);
    console.log("- Host-only start, dice roll, invalid move rejection, legal move/pass and out-of-turn rejection verified.");
    console.log("- Authenticated room read and unauthenticated access rejection verified.");
  } finally {
    if (roomCode) {
      for (const session of sessions) {
        await request(`/api/rooms/${roomCode}/leave`, { token: session.token, body: {} }).catch(() => undefined);
      }
    }
    for (const session of sessions) {
      await request("/api/auth/logout", { token: session.token, body: {} }).catch(() => undefined);
    }
  }
}

main().catch(error => {
  console.error("STAGING MULTIPLAYER INTEGRATION FAILED");
  console.error(error);
  process.exitCode = 1;
});
