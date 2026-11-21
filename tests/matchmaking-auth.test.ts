import { afterEach, describe, expect, it, vi } from "vitest";
import { AppData, MatchmakingLobby } from "../worker/index.ts";

class MemoryStorage {
  data = new Map<string, unknown>();
  async get<T>(key: string): Promise<T | undefined> { return this.data.get(key) as T | undefined; }
  async put<T>(key: string, value: T): Promise<void> { this.data.set(key, structuredClone(value)); }
  async delete(key: string): Promise<boolean> { return this.data.delete(key); }
  async deleteAll(): Promise<void> { this.data.clear(); }
  async transaction<T>(callback: (storage: MemoryStorage) => Promise<T>): Promise<T> { return callback(this); }
}
const ns = (get: (id: string) => any) => ({ idFromName: (id: string) => id, get });
const post = (path: string, body: unknown, headers?: HeadersInit) => new Request("https://test" + path, {
  method: "POST", headers: { "content-type": "application/json", ...Object.fromEntries(new Headers(headers).entries()) }, body: JSON.stringify(body),
});

describe("MatchmakingLobby contracts", () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
  function setup(blocked = false) {
    const storage = new MemoryStorage(), rooms = new Map<string, any>(), created: any[] = [];
    const env = {
      APP_DATA: ns(() => ({ fetch: async () => Response.json({ blocked }) })),
      LUDO_ROOMS: ns((id: string) => {
        if (!rooms.has(id)) rooms.set(id, { fetch: async (url: string, init?: RequestInit) => {
          if (url.endsWith("/create")) {
            const room = JSON.parse(String(init?.body));
            if (rooms.get(id).room) return Response.json({ error: "exists" }, { status: 409 });
            rooms.get(id).room = room; created.push(room); return Response.json({ room });
          }
          if (url.endsWith("/read")) return rooms.get(id).room ? Response.json({ room: rooms.get(id).room }) : Response.json({}, { status: 404 });
          return Response.json({});
        } });
        return rooms.get(id);
      }),
    };
    return { lobby: new MatchmakingLobby({ storage } as never, env as never), storage, created };
  }
  it("returns the original waiting entry for a duplicate join", async () => {
    const { lobby, storage } = setup();
    await lobby.fetch(post("/join", { queueId: "q1", playerId: "p1", name: "One" }));
    const duplicate = await lobby.fetch(post("/join", { queueId: "q2", playerId: "p1", name: "One" }));
    expect(await duplicate.json()).toEqual({ status: "waiting", queueId: "q1" });
    expect(await storage.get<any[]>("entries")).toHaveLength(1);
  });
  it("does not match users when either has blocked the other", async () => {
    const { lobby, created } = setup(true);
    await lobby.fetch(post("/join", { queueId: "q1", playerId: "p1", name: "One" }));
    const result = await lobby.fetch(post("/join", { queueId: "q2", playerId: "p2", name: "Two" }));
    expect((await result.json()).status).toBe("waiting");
    expect(created).toHaveLength(0);
  });
  it("creates exactly one shared 1v1 room for eligible players", async () => {
    const { lobby, created, storage } = setup();
    await lobby.fetch(post("/join", { queueId: "q1", playerId: "p1", name: "One" }));
    const result = await lobby.fetch(post("/join", { queueId: "q2", playerId: "p2", name: "Two" }));
    const payload = await result.json<any>();
    expect(payload.status).toBe("matched");
    expect(payload.room.players.map((p: any) => p.id)).toEqual(["p1", "p2"]);
    expect(created).toHaveLength(1);
    expect((await storage.get<any[]>("entries"))?.map(e => e.status)).toEqual(["matched", "matched"]);
  });
  it("serializes simultaneous joins so two players create exactly one shared room", async () => {
    const { lobby, created, storage } = setup();
    const [first, second] = await Promise.all([
      lobby.fetch(post("/join", { queueId: "q1", playerId: "p1", name: "One" })),
      lobby.fetch(post("/join", { queueId: "q2", playerId: "p2", name: "Two" })),
    ]);
    expect([first.status, second.status]).toEqual([200, 200]);
    expect(created).toHaveLength(1);
    const entries = await storage.get<any[]>("entries");
    expect(entries?.map(entry => entry.status)).toEqual(["matched", "matched"]);
    expect(entries?.map(entry => entry.roomCode).filter(Boolean)).toHaveLength(2);
    expect(entries?.[0].roomCode).toBe(entries?.[1].roomCode);
  });

  it("deduplicates simultaneous joins from the same player", async () => {
    const { lobby, created, storage } = setup();
    const [first, second] = await Promise.all([
      lobby.fetch(post("/join", { queueId: "q1", playerId: "p1", name: "One" })),
      lobby.fetch(post("/join", { queueId: "q2", playerId: "p1", name: "One" })),
    ]);
    expect(await first.json()).toEqual({ status: "waiting", queueId: "q1" });
    expect(await second.json()).toEqual({ status: "waiting", queueId: "q1" });
    expect(await storage.get<any[]>("entries")).toHaveLength(1);
    expect(created).toHaveLength(0);
  });

  it("keeps cancelled entries out of later matches", async () => {
    const { lobby, created, storage } = setup();
    await lobby.fetch(post("/join", { queueId: "q1", playerId: "p1", name: "One" }));
    await lobby.fetch(post("/cancel", { queueId: "q1", playerId: "p1" }));
    await lobby.fetch(post("/join", { queueId: "q2", playerId: "p2", name: "Two" }));
    expect((await storage.get<any[]>("entries"))?.find(e => e.playerId === "p1")?.status).toBe("cancelled");
    expect(created).toHaveLength(0);
  });
  it("expires a waiting entry after 90 seconds", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-20T09:00:00Z"));
    const { lobby } = setup();
    await lobby.fetch(post("/join", { queueId: "q1", playerId: "p1", name: "One" }));
    vi.advanceTimersByTime(90_001);
    const result = await lobby.fetch(post("/status", { queueId: "q1", playerId: "p1" }));
    expect((await result.json()).status).toBe("expired");
  });
  it("rate-limits matchmaking to five attempts per minute", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-20T09:00:00Z"));
    const { lobby } = setup(), statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      statuses.push((await lobby.fetch(post("/join", { queueId: "q" + i, playerId: "p1", name: "One" }))).status);
      await lobby.fetch(post("/cancel", { queueId: "q" + i, playerId: "p1" }));
    }
    expect(statuses.slice(0, 5)).toEqual([200, 200, 200, 200, 200]);
    expect(statuses[5]).toBe(429);
  });
});

describe("AppData authentication and session contracts", () => {
  afterEach(() => vi.useRealTimers());
  function setup() { const storage = new MemoryStorage(); vi.stubGlobal("fetch", vi.fn(async () => Response.json({ id: "email-sent" }))); const env = { RESEND_API_KEY: "test-resend", LUDO_EMAIL_FROM: "LUDO LIVE <mail@example.test>", LUDO_APP_ORIGIN: "https://staging.example.test" }; return { app: new AppData({ storage } as never, env as never), storage }; }
  function latestActionToken(param: "verifyEmail" | "resetPassword") { const calls = (fetch as any).mock.calls; const body = JSON.parse(String(calls[calls.length - 1][1].body)); const href = String(body.html).match(/href="([^"]+)"/)?.[1]; if (!href) throw new Error("Email action link was not generated."); return new URL(href).searchParams.get(param) || ""; }
  it("creates separate identities and isolates bearer sessions", async () => {
    const { app } = setup();
    const a = await app.fetch(post("/auth/register", { name: "Player One", email: "one@example.test", password: "securepass123" }));
    const b = await app.fetch(post("/auth/register", { name: "Player Two", email: "two@example.test", password: "securepass456" }));
    const one = await a.json<any>(), two = await b.json<any>();
    expect(a.status).toBe(200); expect(b.status).toBe(200); expect(one.user.id).not.toBe(two.user.id);
    const meA = await app.fetch(new Request("https://test/auth/me", { headers: { authorization: "Bearer " + one.token } }));
    const meB = await app.fetch(new Request("https://test/auth/me", { headers: { authorization: "Bearer " + two.token } }));
    expect((await meA.json<any>()).user.id).toBe(one.user.id);
    expect((await meB.json<any>()).user.id).toBe(two.user.id);
  });
  it("creates a name-only guest identity with a persistent bearer session", async () => {
    const { app } = setup();
    const result = await app.fetch(post("/auth/guest", { name: "Quick Player" }));
    const payload = await result.json<any>();
    expect(result.status).toBe(200);
    expect(payload.user.name).toBe("Quick Player");
    expect(payload.user.email).toBe("");
    expect(payload.user.isGuest).toBe(true);
    expect(payload.token).toBeTruthy();
    const me = await app.fetch(new Request("https://test/auth/me", { headers: { authorization: "Bearer " + payload.token } }));
    const mePayload = await me.json<any>();
    expect(mePayload.user.id).toBe(payload.user.id);
    expect(mePayload.user.isGuest).toBe(true);
  });

  it("links email credentials to the same guest player ID", async () => {
    const { app } = setup();
    const guestResponse = await app.fetch(post("/auth/guest", { name: "Player Upgrade" }));
    const guest = await guestResponse.json<any>();
    const upgrade = await app.fetch(post("/auth/upgrade", {
      email: "upgrade@example.test",
      password: "securepass789",
    }, { authorization: "Bearer " + guest.token }));
    const linked = await upgrade.json<any>();
    expect(upgrade.status).toBe(202);
    expect(linked.verificationRequired).toBe(true);
    expect(linked.user.id).toBe(guest.user.id);
    expect(linked.user.isGuest).toBe(true);
    const verify = await app.fetch(post("/auth/verify-email", { token: latestActionToken("verifyEmail") }));
    const verified = await verify.json<any>();
    expect(verify.status).toBe(200);
    expect(verified.user.id).toBe(guest.user.id);
    expect(verified.user.email).toBe("upgrade@example.test");
    expect(verified.user.isGuest).toBe(false);
    const me = await app.fetch(new Request("https://test/auth/me", { headers: { authorization: "Bearer " + guest.token } }));
    const mePayload = await me.json<any>();
    expect(mePayload.user.id).toBe(guest.user.id);
    expect(mePayload.user.isGuest).toBe(false);
  });

  it("rejects weak passwords and duplicate emails when upgrading guest profiles", async () => {
    const { app } = setup();
    await app.fetch(post("/auth/register", { name: "Existing", email: "taken@example.test", password: "securepass123" }));
    const guestResponse = await app.fetch(post("/auth/guest", { name: "Guest Player" }));
    const guest = await guestResponse.json<any>();
    const weak = await app.fetch(post("/auth/upgrade", { email: "guest@example.test", password: "short" }, { authorization: "Bearer " + guest.token }));
    const duplicate = await app.fetch(post("/auth/upgrade", { email: "taken@example.test", password: "securepass456" }, { authorization: "Bearer " + guest.token }));
    expect(weak.status).toBe(400);
    expect(duplicate.status).toBe(409);
  });

  it("requires mailbox verification before sign-in and unlocks the same account after verification", async () => {
    const { app } = setup();
    const registered = await app.fetch(post("/auth/register", { name: "Verify Player", email: "verify@example.test", password: "securepass123" }));
    const payload = await registered.json<any>();
    expect(registered.status).toBe(202);
    expect(payload.user.isGuest).toBe(true);
    const blockedLogin = await app.fetch(post("/auth/login", { email: "verify@example.test", password: "securepass123" }));
    expect(blockedLogin.status).toBe(403);
    const verified = await app.fetch(post("/auth/verify-email", { token: latestActionToken("verifyEmail") }));
    expect(verified.status).toBe(200);
    expect((await verified.json<any>()).user.emailVerified).toBe(true);
    const login = await app.fetch(post("/auth/login", { email: "verify@example.test", password: "securepass123" }));
    expect(login.status).toBe(200);
    expect((await login.json<any>()).user.isGuest).toBe(false);
  });

  it("sends password reset with a single-use token and revokes existing sessions", async () => {
    const { app } = setup();
    const registered = await app.fetch(post("/auth/register", { name: "Reset Player", email: "reset@example.test", password: "securepass123" }));
    const signup = await registered.json<any>();
    const verified = await app.fetch(post("/auth/verify-email", { token: latestActionToken("verifyEmail") }));
    expect(verified.status).toBe(200);
    const forgot = await app.fetch(post("/auth/password/forgot", { email: "reset@example.test" }));
    expect(forgot.status).toBe(200);
    const resetToken = latestActionToken("resetPassword");
    const reset = await app.fetch(post("/auth/password/reset", { token: resetToken, password: "newsecurepass456" }));
    expect(reset.status).toBe(200);
    const replay = await app.fetch(post("/auth/password/reset", { token: resetToken, password: "anothersecure789" }));
    expect(replay.status).toBe(400);
    const oldSession = await app.fetch(new Request("https://test/auth/me", { headers: { authorization: "Bearer " + signup.token } }));
    expect(oldSession.status).toBe(401);
    const login = await app.fetch(post("/auth/login", { email: "reset@example.test", password: "newsecurepass456" }));
    expect(login.status).toBe(200);
  });

  it("resolves friend request names from stored player accounts, not client input", async () => {
    const { app } = setup();
    const a = await app.fetch(post("/auth/register", { name: "Alice Real", email: "alice-friends@example.test", password: "securepass123" }));
    const b = await app.fetch(post("/auth/register", { name: "Bob Real", email: "bob-friends@example.test", password: "securepass456" }));
    const alice = (await a.json<any>()).user, bob = (await b.json<any>()).user;
    const sent = await app.fetch(post("/friends/request", {
      playerId: alice.id, playerName: "Fake Alice", targetPlayerId: bob.id, targetPlayerName: "Fake Bob",
    }));
    const payload = await sent.json<any>();
    expect(sent.status).toBe(200);
    expect(payload.friendship.playerName).toBe("Alice Real");
    expect(payload.friendship.targetPlayerName).toBe("Bob Real");
    const inbox = await app.fetch(new Request("https://test/friends/" + encodeURIComponent(bob.id)));
    const incoming = await inbox.json<any>();
    expect(incoming.incoming[0].playerName).toBe("Alice Real");
    expect(incoming.incoming[0].playerId).toBe(alice.id);
  });

  it("rejects friend requests for unknown player IDs", async () => {
    const { app } = setup();
    const a = await app.fetch(post("/auth/register", { name: "Alice", email: "alice-unknown@example.test", password: "securepass123" }));
    const alice = (await a.json<any>()).user;
    const response = await app.fetch(post("/friends/request", { playerId: alice.id, targetPlayerId: "not-a-real-player" }));
    expect(response.status).toBe(404);
  });

  it("automatically accepts a pending friend request when the other player sends one back", async () => {
    const { app } = setup();
    const a = await app.fetch(post("/auth/register", { name: "Alice", email: "alice-recip@example.test", password: "securepass123" }));
    const b = await app.fetch(post("/auth/register", { name: "Bob", email: "bob-recip@example.test", password: "securepass456" }));
    const alice = (await a.json<any>()).user, bob = (await b.json<any>()).user;
    await app.fetch(post("/friends/request", { playerId: alice.id, targetPlayerId: bob.id }));
    const reciprocal = await app.fetch(post("/friends/request", { playerId: bob.id, targetPlayerId: alice.id }));
    expect(reciprocal.status).toBe(200);
    expect((await reciprocal.json<any>()).friendship.status).toBe("accepted");
    const aliceFriends = await app.fetch(new Request("https://test/friends/" + encodeURIComponent(alice.id)));
    expect((await aliceFriends.json<any>()).friends).toHaveLength(1);
  });

  it("rejects an expired session", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-20T09:00:00Z"));
    const { app } = setup();
    const result = await app.fetch(post("/auth/register", { name: "Player", email: "expire@example.test", password: "securepass123" }));
    const { token } = await result.json<any>();
    vi.advanceTimersByTime(30 * 24 * 60 * 60 * 1000 + 1);
    expect((await app.fetch(new Request("https://test/auth/me", { headers: { authorization: "Bearer " + token } }))).status).toBe(401);
  });
  it("revokes a session on logout", async () => {
    const { app } = setup();
    const result = await app.fetch(post("/auth/register", { name: "Player", email: "logout@example.test", password: "securepass123" }));
    const { token } = await result.json<any>();
    await app.fetch(post("/auth/logout", {}, { authorization: "Bearer " + token }));
    expect((await app.fetch(new Request("https://test/auth/me", { headers: { authorization: "Bearer " + token } }))).status).toBe(401);
  });
  it("does not issue a session for an incorrect password", async () => {
    const { app } = setup();
    await app.fetch(post("/auth/register", { name: "Player", email: "wrong@example.test", password: "securepass123" }));
    const login = await app.fetch(post("/auth/login", { email: "wrong@example.test", password: "incorrect999" }));
    expect(login.status).toBe(401); expect((await login.json<any>()).token).toBeUndefined();
  });
});
