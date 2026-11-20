import { describe, expect, it } from "vitest";
import worker from "../worker/index.ts";

const USER: { id: string; name: string; email: string; isGuest?: boolean } = { id: "account-1", name: "Trusted Player", email: "trusted@example.test" };
const ORIGIN = "https://example.test";

function harness(user: typeof USER = USER) {
  const hubCalls: Array<{ path: string; body: any }> = [];
  const rooms = new Map<string, any>();
  const hub = {
    fetch: async (url: string, init?: RequestInit) => {
      const parsed = new URL(url);
      hubCalls.push({ path: parsed.pathname, body: init?.body ? JSON.parse(String(init.body)) : null });
      return Response.json({ ok: true });
    },
  };
  const appData = {
    fetch: async (url: string, init?: RequestInit) => {
      const parsed = new URL(url);
      if (parsed.pathname === "/auth/verify") return Response.json({ user });
      if (parsed.pathname === "/auth/guest") return Response.json({ token: "guest-session", user: { id: "guest-player", name: "New Player", email: "", isGuest: true } });
      if (parsed.pathname === "/auth/realtime-ticket") return Response.json({ ticket: "single-use-ticket", expiresIn: 60 });
      if (parsed.pathname === "/block-status") return Response.json({ blocked: false });
      if (parsed.pathname === "/results") return Response.json({ ok: true });
      return Response.json({ error: "not found" }, { status: 404 });
    },
  };
  const roomNamespace = {
    idFromName: (id: string) => id,
    get: (id: string) => ({
      fetch: async (url: string, init?: RequestInit) => {
        const parsed = new URL(url);
        if (parsed.pathname === "/create") {
          const room = JSON.parse(String(init?.body));
          if (rooms.has(id)) return Response.json({ error: "exists" }, { status: 409 });
          rooms.set(id, room);
          return Response.json({ room });
        }
        if (parsed.pathname === "/read") {
          const room = rooms.get(id);
          if (!room) return Response.json({ error: "missing" }, { status: 404 });
          return Response.json({ room });
        }
        if (parsed.pathname === "/presence/reconnect") return Response.json({ ok: true });
        return Response.json({ error: "not found" }, { status: 404 });
      },
    }),
  };
  const namespace = (stub: any) => ({ idFromName: (id: string) => id, get: () => stub });
  const env = {
    APP_DATA: namespace(appData),
    LUDO_ROOMS: roomNamespace,
    REALTIME_HUB: namespace(hub),
    MATCHMAKING: namespace({ fetch: async () => Response.json({}) }),
    ALLOWED_ORIGIN: ORIGIN,
  };
  const request = (path: string, body?: unknown, token = "valid-session") =>
    new Request("https://api.example.test" + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        origin: ORIGIN,
        ...(token ? { authorization: "Bearer " + token } : {}),
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  return { env, rooms, hubCalls, request };
}

describe("Worker authenticated API boundary", () => {
  it("allows name-only guest creation without a pre-existing bearer token", async () => {
    const h = harness();
    const response = await worker.fetch(h.request("/api/auth/guest", { name: "New Player" }, ""), h.env as never);
    expect(response.status).toBe(200);
    const payload = await response.json<any>();
    expect(payload.user.id).toBe("guest-player");
    expect(payload.user.isGuest).toBe(true);
  });

  it("blocks guest players from creating tournaments at the Worker boundary", async () => {
    const h = harness({ ...USER, isGuest: true });
    const response = await worker.fetch(
      h.request("/api/tournaments", { name: "Guest Cup", maxPlayers: 4 }),
      h.env as never,
    );
    expect(response.status).toBe(403);
    expect((await response.json<any>()).error).toContain("Add an email");
  });

  it("rejects requests to protected API routes without a bearer session", async () => {
    const h = harness();
    const response = await worker.fetch(h.request("/api/rooms/ABC123", undefined, ""), h.env as never);
    expect(response.status).toBe(401);
  });

  it("forwards the bearer session to the single-use realtime ticket issuer", async () => {
    const h = harness();
    let forwardedAuthorization = "";
    const originalGet = h.env.APP_DATA.get;
    h.env.APP_DATA.get = (id: string) => {
      const stub = originalGet(id);
      return {
        fetch: async (url: string, init?: RequestInit) => {
          if (new URL(url).pathname === "/auth/realtime-ticket") {
            forwardedAuthorization = new Headers(init?.headers).get("authorization") || "";
          }
          return stub.fetch(url, init);
        },
      };
    };
    const response = await worker.fetch(h.request("/api/auth/realtime-ticket", {}), h.env as never);
    expect(response.status).toBe(200);
    expect(forwardedAuthorization).toBe("Bearer valid-session");
    expect((await response.json<any>()).ticket).toBe("single-use-ticket");
  });

  it("prevents a player from subscribing to another account's private inbox", async () => {
    const h = harness();
    const response = await worker.fetch(
      h.request("/api/subscriptions", {
        connection_id: "connection-1",
        entity_type: "private-chat",
        entity_id: "ABC123_someone-else",
      }),
      h.env as never,
    );
    expect(response.status).toBe(403);
    expect(h.hubCalls).toHaveLength(0);
  });

  it("binds private inbox subscription identity to the authenticated session", async () => {
    const h = harness();
    const response = await worker.fetch(
      h.request("/api/subscriptions", {
        connection_id: "connection-1",
        user_id: "spoofed-user",
        entity_type: "private-chat",
        entity_id: "ABC123_account-1",
      }),
      h.env as never,
    );
    expect(response.status).toBe(200);
    expect(h.hubCalls[0].path).toBe("/subscribe");
    expect(h.hubCalls[0].body.user_id).toBe(USER.id);
  });

  it("requires room membership and call participation before call-signal subscription", async () => {
    const h = harness();
    h.rooms.set("ABC123", {
      code: "ABC123",
      players: [{ id: USER.id, name: USER.name }],
      callParticipants: [],
    });
    const body = { connection_id: "connection-1", entity_type: "call-signal", entity_id: "ABC123" };
    const denied = await worker.fetch(h.request("/api/subscriptions", body), h.env as never);
    expect(denied.status).toBe(403);
    expect(h.hubCalls).toHaveLength(0);

    h.rooms.get("ABC123").callParticipants.push(USER.id);
    const allowed = await worker.fetch(h.request("/api/subscriptions", body), h.env as never);
    expect(allowed.status).toBe(200);
    expect(h.hubCalls[0].path).toBe("/subscribe");
    expect(h.hubCalls[0].body.user_id).toBe(USER.id);
  });

  it("replaces spoofed player identity and display name when creating a room", async () => {
    const h = harness();
    const response = await worker.fetch(
      h.request("/api/rooms", { playerId: "attacker-id", name: "Impersonated Name", gameMode: "classic" }),
      h.env as never,
    );
    expect(response.status).toBe(200);
    const created = [...h.rooms.values()][0];
    expect(created.players).toHaveLength(1);
    expect(created.players[0].id).toBe(USER.id);
    expect(created.players[0].name).toBe(USER.name);
    expect(created.players[0].host).toBe(true);
  });

  it("does not expose replay data before a room is finished", async () => {
    const h = harness();
    h.rooms.set("ABC123", { code: "ABC123", status: "playing", replaySnapshots: [] });
    const response = await worker.fetch(h.request("/api/rooms/ABC123/replay"), h.env as never);
    expect(response.status).toBe(404);
    expect((await response.json<any>()).error).toContain("after a match has finished");
  });

  it("serves replay snapshots only after a match is finished", async () => {
    const h = harness();
    h.rooms.set("ABC123", {
      code: "ABC123",
      status: "finished",
      lastActivity: 123,
      gameMode: "classic",
      players: [{ id: USER.id, name: USER.name }],
      state: { winner: USER.id, winnerTeam: null },
      replaySnapshots: [{ version: 3, at: 123, turnMessage: "Winner" }],
    });
    const response = await worker.fetch(h.request("/api/rooms/ABC123/replay"), h.env as never);
    expect(response.status).toBe(200);
    const replay = await response.json<any>();
    expect(replay.roomCode).toBe("ABC123");
    expect(replay.winnerId).toBe(USER.id);
    expect(replay.events).toHaveLength(1);
  });
});
