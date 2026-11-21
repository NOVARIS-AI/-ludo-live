import { afterEach, describe, expect, it, vi } from "vitest";
import { LudoRoom } from "../worker/index.ts";

type Stored = Map<string, unknown>;

class MemoryStorage {
  data: Stored = new Map();
  alarmAt: number | null = null;
  async get<T>(key: string): Promise<T | undefined> { return this.data.get(key) as T | undefined; }
  async put<T>(key: string, value: T): Promise<void> { this.data.set(key, structuredClone(value)); }
  async delete(key: string): Promise<boolean> { return this.data.delete(key); }
  async deleteAll(): Promise<void> { this.data.clear(); }
  async setAlarm(at: number): Promise<void> { this.alarmAt = at; }
  async deleteAlarm(): Promise<void> { this.alarmAt = null; }
  async transaction<T>(callback: (storage: MemoryStorage) => Promise<T>): Promise<T> { return callback(this); }
}

function makeRoom() {
  const players = [
    { id: "p1", name: "Host", color: "red", host: true, joinedAt: 1 },
    { id: "p2", name: "Guest", color: "blue", host: false, joinedAt: 2 },
  ];
  return {
    id: "ABC123", code: "ABC123", players, status: "waiting" as const,
    mode: "friends" as const, gameMode: "classic" as const,
    state: { currentTurnIndex: 0, dice: null, consecutiveSixes: 0, tokens: { p1: [-1, -1, -1, -1], p2: [-1, -1, -1, -1] }, winner: null, winnerTeam: null, turnMessage: "Waiting", lastRoll: null },
    messages: [], callParticipants: [], version: 1, createdAt: 1, lastActivity: 1, replaySnapshots: [],
  };
}

function setup(blocked = false) {
  const storage = new MemoryStorage();
  const broadcasts: unknown[] = [];
  const hub = { fetch: async (_url: string, init?: RequestInit) => { broadcasts.push(init?.body ? JSON.parse(String(init.body)) : null); return Response.json({ ok: true }); } };
  const appData = { fetch: async () => Response.json({ blocked }) };
  const namespace = (stub: { fetch: (url: string, init?: RequestInit) => Promise<Response> }) => ({
    idFromName: (name: string) => name,
    get: () => stub,
  });
  const env = {
    LUDO_ROOMS: namespace({ fetch: async () => Response.json({}) }),
    REALTIME_HUB: namespace(hub),
    MATCHMAKING: namespace({ fetch: async () => Response.json({}) }),
    APP_DATA: namespace(appData),
    ALLOWED_ORIGIN: "https://example.test",
  };
  const room = new LudoRoom({ storage } as never, env as never);
  return { room, storage, broadcasts };
}

async function action(room: LudoRoom, name: string, input: Record<string, unknown>) {
  return room.fetch(new Request("https://room/action", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: name, input }),
  }));
}

describe("LudoRoom multiplayer and security contracts", () => {
  afterEach(() => vi.useRealTimers());

  it("rejects duplicate room creation without overwriting the existing room", async () => {
    const { room, storage } = setup();
    const initial = makeRoom();
    const first = await room.fetch(new Request("https://room/create", { method: "POST", body: JSON.stringify(initial) }));
    const second = await room.fetch(new Request("https://room/create", { method: "POST", body: JSON.stringify({ ...initial, code: "OTHER1" }) }));
    expect(first.status).toBe(200);
    expect(second.status).toBe(409);
    expect((await storage.get<any>("room")).code).toBe("ABC123");
  });

  it("allows only the host to start a match", async () => {
    const { room, storage } = setup();
    await storage.put("room", makeRoom());
    const guest = await action(room, "start", { playerId: "p2" });
    expect(guest.status).toBe(403);
    const host = await action(room, "start", { playerId: "p1" });
    expect(host.status).toBe(200);
    expect((await storage.get<any>("room")).status).toBe("playing");
  });

  it("rejects a roll from a player whose turn is not active", async () => {
    const { room, storage } = setup();
    const game = makeRoom();
    game.status = "playing";
    await storage.put("room", game);
    const response = await action(room, "roll", { playerId: "p2" });
    expect(response.status).toBe(403);
    expect((await storage.get<any>("room")).state.dice).toBeNull();
  });

  it("prevents rolling twice before the current dice is resolved", async () => {
    const { room, storage } = setup();
    const game = makeRoom();
    game.status = "playing";
    await storage.put("room", game);
    const first = await action(room, "roll", { playerId: "p1" });
    expect(first.status).toBe(200);
    const second = await action(room, "roll", { playerId: "p1" });
    expect(second.status).toBe(400);
  });

  it("rejects token indices outside the four-token range", async () => {
    const { room, storage } = setup();
    const game = makeRoom();
    game.status = "playing";
    game.state.dice = 6;
    await storage.put("room", game);
    const response = await action(room, "move", { playerId: "p1", tokenIndex: 4 });
    expect(response.status).toBe(400);
  });

  it("restores a disconnected player within the 120-second grace period", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-20T08:00:00Z"));
    const { room, storage } = setup();
    await storage.put("room", makeRoom());
    const disconnected = await room.fetch(new Request("https://room/presence/disconnect", {
      method: "POST", body: JSON.stringify({ playerId: "p2" }),
    }));
    expect(disconnected.status).toBe(200);
    expect(storage.alarmAt).toBe(Date.now() + 120_000);
    const reconnected = await room.fetch(new Request("https://room/presence/reconnect", {
      method: "POST", body: JSON.stringify({ playerId: "p2" }),
    }));
    expect(reconnected.status).toBe(200);
    expect(storage.alarmAt).toBeNull();
    expect((await storage.get<any>("room")).disconnectedAt).toBeUndefined();
  });

  it("removes a player after the reconnect grace period and preserves a host", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-20T08:00:00Z"));
    const { room, storage } = setup();
    await storage.put("room", makeRoom());
    await room.fetch(new Request("https://room/presence/disconnect", {
      method: "POST", body: JSON.stringify({ playerId: "p1" }),
    }));
    vi.advanceTimersByTime(120_001);
    await room.alarm();
    const saved = await storage.get<any>("room");
    expect(saved.players.map((player: any) => player.id)).toEqual(["p2"]);
    expect(saved.players[0].host).toBe(true);
    expect(saved.disconnectedAt).toBeUndefined();
  });

  it("enforces the per-player room chat burst limit", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-20T08:00:00Z"));
    const { room, storage } = setup();
    await storage.put("room", makeRoom());
    const results: number[] = [];
    for (let i = 0; i < 9; i++) {
      results.push((await action(room, "chat", { playerId: "p1", text: "hello" })).status);
      vi.advanceTimersByTime(1_000);
    }
    expect(results.slice(0, 8).every(status => status === 200)).toBe(true);
    expect(results[8]).toBe(429);
  });
  it("rejects passing when the player still has a legal move", async () => {
    const { room, storage } = setup();
    const game = makeRoom();
    game.status = "playing";
    game.state.dice = 6;
    await storage.put("room", game);
    const response = await action(room, "pass", { playerId: "p1" });
    expect(response.status).toBe(400);
    expect((await storage.get<any>("room")).state.dice).toBe(6);
  });

  it("passes the turn when a roll has no legal token move", async () => {
    const { room, storage } = setup();
    const game = makeRoom();
    game.status = "playing";
    game.state.dice = 3;
    await storage.put("room", game);
    const response = await action(room, "pass", { playerId: "p1" });
    expect(response.status).toBe(200);
    const saved = await storage.get<any>("room");
    expect(saved.state.dice).toBeNull();
    expect(saved.state.currentTurnIndex).toBe(1);
    expect(saved.state.turnMessage).toContain("Guest");
  });

  it("does not let a player move before rolling", async () => {
    const { room, storage } = setup();
    const game = makeRoom();
    game.status = "playing";
    await storage.put("room", game);
    const response = await action(room, "move", { playerId: "p1", tokenIndex: 0 });
    expect(response.status).toBe(400);
    expect((await storage.get<any>("room")).state.tokens.p1).toEqual([-1, -1, -1, -1]);
  });

  it("requires a six before bringing a token out of the yard", async () => {
    const { room, storage } = setup();
    const game = makeRoom();
    game.status = "playing";
    game.state.dice = 4;
    await storage.put("room", game);
    const response = await action(room, "move", { playerId: "p1", tokenIndex: 0 });
    expect(response.status).toBe(400);
    expect((await storage.get<any>("room")).state.tokens.p1[0]).toBe(-1);
  });

  it("skips the turn after three consecutive sixes", async () => {
    const { room, storage } = setup();
    const game = makeRoom();
    game.status = "playing";
    game.state.tokens.p1[0] = 0;
    await storage.put("room", game);
    const random = vi.spyOn(Math, "random").mockReturnValue(0.99);
    try {
      expect((await action(room, "roll", { playerId: "p1" })).status).toBe(200);
      expect((await action(room, "move", { playerId: "p1", tokenIndex: 0 })).status).toBe(200);
      expect((await action(room, "roll", { playerId: "p1" })).status).toBe(200);
      expect((await action(room, "move", { playerId: "p1", tokenIndex: 0 })).status).toBe(200);
      expect((await action(room, "roll", { playerId: "p1" })).status).toBe(200);
      const saved = await storage.get<any>("room");
      expect(saved.state.lastRoll).toBe(6);
      expect(saved.state.dice).toBeNull();
      expect(saved.state.consecutiveSixes).toBe(0);
      expect(saved.state.currentTurnIndex).toBe(1);
      expect(saved.state.turnMessage).toContain("Three sixes");
    } finally {
      random.mockRestore();
    }
  });

  it("captures an opponent token on an unprotected square", async () => {
    const { room, storage } = setup();
    const game = makeRoom();
    game.status = "playing";
    game.state.tokens.p1[0] = 1;
    game.state.tokens.p2[0] = 41;
    game.state.dice = 1;
    await storage.put("room", game);
    const response = await action(room, "move", { playerId: "p1", tokenIndex: 0 });
    expect(response.status).toBe(200);
    const saved = await storage.get<any>("room");
    expect(saved.state.tokens.p1[0]).toBe(2);
    expect(saved.state.tokens.p2[0]).toBe(-1);
    expect(saved.state.turnMessage).toContain("captured");
  });

  it("does not capture an opponent token on a safe square", async () => {
    const { room, storage } = setup();
    const game = makeRoom();
    game.status = "playing";
    game.state.tokens.p1[0] = 7;
    game.state.tokens.p2[0] = 47;
    game.state.dice = 1;
    await storage.put("room", game);
    const response = await action(room, "move", { playerId: "p1", tokenIndex: 0 });
    expect(response.status).toBe(200);
    const saved = await storage.get<any>("room");
    expect(saved.state.tokens.p1[0]).toBe(8);
    expect(saved.state.tokens.p2[0]).toBe(47);
  });

  it("stores private messages for the two room members and broadcasts only to their inbox channels", async () => {
    const { room, storage, broadcasts } = setup();
    await storage.put("room", makeRoom());
    const sent = await action(room, "private-chat", { playerId: "p1", toPlayerId: "p2", text: "Ready?" });
    expect(sent.status).toBe(200);
    const payload = await sent.json<any>();
    expect(payload.message.playerId).toBe("p1");
    expect(payload.message.recipientId).toBe("p2");
    const saved = await storage.get<any[]>("dm:p1:p2");
    expect(saved).toHaveLength(1);
    expect(broadcasts.slice(-2).map((item: any) => item.payload.entity_id)).toEqual(["ABC123_p1", "ABC123_p2"]);
    const inbox = await action(room, "private-chat/list", { playerId: "p2", peerId: "p1" });
    expect((await inbox.json<any>()).messages).toHaveLength(1);
  });

  it("blocks private messages when either account has blocked the other", async () => {
    const { room, storage } = setup(true);
    await storage.put("room", makeRoom());
    const response = await action(room, "private-chat", { playerId: "p1", toPlayerId: "p2", text: "Hello" });
    expect(response.status).toBe(403);
    expect(await storage.get<any[]>("dm:p1:p2")).toBeUndefined();
  });

  it("requires both players to join a live call before exchanging call signals", async () => {
    const { room, storage, broadcasts } = setup();
    await storage.put("room", makeRoom());
    const denied = await action(room, "signal", { playerId: "p1", toPlayerId: "p2", signal: { type: "offer", sdp: "test" } });
    expect(denied.status).toBe(403);
    await action(room, "call/join", { playerId: "p1" });
    await action(room, "call/join", { playerId: "p2" });
    const sent = await action(room, "signal", { playerId: "p1", toPlayerId: "p2", signal: { type: "offer", sdp: "test" } });
    expect(sent.status).toBe(200);
    expect((await sent.json<any>()).sent).toBe(true);
    expect((broadcasts.at(-1) as any).payload.entity_type).toBe("call-signal");
  });

  it("removes a player from call participants when they leave the call", async () => {
    const { room, storage } = setup();
    await storage.put("room", makeRoom());
    await action(room, "call/join", { playerId: "p1" });
    await action(room, "call/join", { playerId: "p1" });
    expect((await storage.get<any>("room")).callParticipants).toEqual(["p1"]);
    await action(room, "call/leave", { playerId: "p1" });
    expect((await storage.get<any>("room")).callParticipants).toEqual([]);
  });

  it("records replay snapshots when gameplay state changes", async () => {
    const { room, storage } = setup();
    const game = makeRoom();
    game.status = "playing";
    game.state.dice = 1;
    game.state.tokens.p1[0] = 2;
    await storage.put("room", game);
    const moved = await action(room, "move", { playerId: "p1", tokenIndex: 0 });
    expect(moved.status).toBe(200);
    const saved = await storage.get<any>("room");
    expect(saved.replaySnapshots).toHaveLength(1);
    expect(saved.replaySnapshots[0].tokens.p1[0]).toBe(3);
    expect(saved.replaySnapshots[0].version).toBe(2);
  });

});
