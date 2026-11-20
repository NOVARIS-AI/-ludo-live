import WebSocket from "ws";
import { randomUUID } from "node:crypto";

const workerBase = (process.env.LUDO_STAGING_WORKER_API_URL || "").replace(/\\/+$/, "");
const pagesOrigin = process.env.LUDO_STAGING_PAGES_ORIGIN || "";
if (!workerBase || !pagesOrigin) throw new Error("Staging Worker URL and Pages origin are required.");

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

function assert(ok, message) { if (!ok) throw new Error(message); }
function expectStatus(result, status, label) {
  assert(result.status === status, `${label}: expected HTTP ${status}, got ${result.status}: ${result.data.error || result.data.message || ""}`);
}
function waitForMessage(socket, predicate, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); reject(new Error("Timed out waiting for realtime room update.")); }, timeoutMs);
    const onMessage = event => {
      try {
        const message = JSON.parse(String(event.data));
        if (predicate(message)) { cleanup(); resolve(message); }
      } catch { /* ignore unrelated frames */ }
    };
    const onClose = () => { cleanup(); reject(new Error("Realtime socket closed before update arrived.")); };
    function cleanup() {
      clearTimeout(timer);
      socket.removeEventListener("message", onMessage);
      socket.removeEventListener("close", onClose);
    }
    socket.addEventListener("message", onMessage);
    socket.addEventListener("close", onClose);
  });
}
async function openSocket(token) {
  const ticket = await request("/api/auth/realtime-ticket", { token, method: "POST" });
  expectStatus(ticket, 200, "Issue single-use realtime ticket");
  assert(ticket.data.ticket, "Realtime ticket endpoint returned no ticket.");
  const wsUrl = workerBase.replace(/^https:/, "wss:").replace(/^http:/, "ws:") + "/connect";
  const url = new URL(wsUrl);
  const connectionId = randomUUID();
  url.searchParams.set("connection_id", connectionId);
  url.searchParams.set("ticket", ticket.data.ticket);
  const socket = new WebSocket(url, { origin: pagesOrigin });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.terminate(); reject(new Error("Realtime WebSocket connection timed out.")); }, 10000);
    socket.once("open", () => { clearTimeout(timer); resolve(); });
    socket.once("error", error => { clearTimeout(timer); reject(error); });
  });
  socket.connectionId = connectionId;
  return socket;
}

async function main() {
  const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  const password = `LudoRealtime-${randomUUID().slice(0, 12)}-B7`;
  const accounts = [
    { name: "Realtime Player One", email: `ludo-realtime-one-${suffix}@example.com` },
    { name: "Realtime Player Two", email: `ludo-realtime-two-${suffix}@example.com` },
  ];
  const sessions = [];
  const sockets = [];
  let roomCode = "";
  try {
    for (const account of accounts) {
      const result = await request("/api/auth/register", { body: { ...account, password } });
      expectStatus(result, 200, "Register realtime test player");
      assert(result.data.user?.id && result.data.token, "Realtime test registration returned no session.");
      sessions.push({ ...account, id: result.data.user.id, token: result.data.token });
    }
    const created = await request("/api/rooms", { token: sessions[0].token, body: { gameMode: "one-v-one" } });
    expectStatus(created, 200, "Create realtime test room");
    roomCode = created.data.room?.code;
    assert(roomCode, "Realtime test room code missing.");
    const joined = await request(`/api/rooms/${roomCode}/join`, { token: sessions[1].token, body: {} });
    expectStatus(joined, 200, "Join realtime test room");

    for (const session of sessions) {
      const socket = await openSocket(session.token);
      sockets.push(socket);
      const connectionId = socket.connectionId;
      assert(connectionId, "Could not recover WebSocket connection identifier.");
      const subscribed = await request("/api/subscriptions", {
        token: session.token,
        body: { entity_type: "room", entity_id: roomCode, connection_id: connectionId },
      });
      expectStatus(subscribed, 200, "Subscribe authenticated player to room");
    }

    const updates = sockets.map(socket => waitForMessage(socket, message =>
      message?.type === "entity.update" &&
      message?.payload?.entity_type === "room" &&
      message?.payload?.entity_id === roomCode
    ));
    const started = await request(`/api/rooms/${roomCode}/start`, { token: sessions[0].token, body: {} });
    expectStatus(started, 200, "Start room to trigger realtime broadcast");
    const delivered = await Promise.all(updates);
    assert(delivered.length === 2, "Not every subscribed player received the room update.");
    console.log("STAGING REALTIME WEBSOCKET INTEGRATION PASSED");
    console.log("- Two independently authenticated WebSockets connected using single-use tickets.");
    console.log("- Both players subscribed to the same Durable Object room channel.");
    console.log("- Host start event reached both subscribed sockets.");
  } finally {
    for (const socket of sockets) { try { socket.close(1000, "staging test complete"); } catch { /* ignore */ } }
    if (roomCode) for (const session of sessions) {
      await request(`/api/rooms/${roomCode}/leave`, { token: session.token, body: {} }).catch(() => undefined);
    }
    for (const session of sessions) await request("/api/auth/logout", { token: session.token, body: {} }).catch(() => undefined);
  }
}

main().catch(error => {
  console.error("STAGING REALTIME WEBSOCKET INTEGRATION FAILED");
  console.error(error);
  process.exitCode = 1;
});
