export interface Env {
  LUDO_ROOMS: DurableObjectNamespace;
  REALTIME_HUB: DurableObjectNamespace;
  ALLOWED_ORIGIN: string;
}

type Player = { id: string; name: string; color: string; host: boolean; joinedAt: number; isBot?: boolean; teamId?: string };
type Room = {
  id: string; code: string; players: Player[]; status: "waiting" | "playing" | "finished";
  mode: "friends" | "computer"; gameMode: "classic" | "one-v-one" | "duo";
  state: { currentTurnIndex: number; dice: number | null; consecutiveSixes: number; tokens: Record<string, number[]>; winner: string | null; winnerTeam: string | null; turnMessage: string; lastRoll: number | null; botActionVersion?: number };
  messages: Array<{ id: string; playerId: string; name: string; color: string; text: string; kind: string; createdAt: number }>;
  callParticipants: string[]; version: number; createdAt: number; lastActivity: number;
  replaySnapshots: Array<{ version: number; at: number; turnMessage: string; currentTurnIndex: number; dice: number | null; tokens: Record<string, number[]>; winner: string | null; winnerTeam?: string | null }>;
};
const colors = ["red", "blue", "yellow", "green"];
const starts: Record<string, number> = { red: 1, blue: 14, yellow: 27, green: 40 };
const safeSquares = new Set([1, 9, 14, 22, 27, 35, 40, 48]);
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
const fail = (message: string, status = 400) => json({ error: message }, status);
const clean = (v: unknown, max = 100) => typeof v === "string" ? v.trim().slice(0, max) : "";
function newCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}
function nameOf(v: unknown) {
  const name = clean(v, 18).replace(/\s+/g, " ");
  if (!name) throw new Error("Enter a player name first.");
  return name;
}
function newState(players: Player[], message: string) {
  return { currentTurnIndex: 0, dice: null, consecutiveSixes: 0, tokens: Object.fromEntries(players.map(p => [p.id, [-1, -1, -1, -1]])), winner: null, winnerTeam: null, turnMessage: message, lastRoll: null, botActionVersion: 0 };
}
function nextPlayer(room: Room, index: number) { return (index + 1) % room.players.length; }
function validMoves(room: Room, playerId: string, dice: number) {
  return (room.state.tokens[playerId] || [-1, -1, -1, -1]).map((pos, i) => pos === -1 ? (dice === 6 ? i : -1) : (pos + dice <= 57 ? i : -1)).filter(i => i >= 0);
}
function requirePlayer(room: Room, playerId: string) {
  const index = room.players.findIndex(p => p.id === playerId);
  if (index < 0) throw Object.assign(new Error("You are not a player in this room."), { status: 403 });
  return index;
}
function moveToken(room: Room, player: Player, tokenIndex: number, dice: number) {
  const positions = room.state.tokens[player.id];
  const old = positions[tokenIndex];
  if (old === -1 && dice !== 6) throw new Error("You need a six to bring a token out.");
  if (old >= 0 && old + dice > 57) throw new Error("That token cannot move.");
  const next = old === -1 ? 0 : old + dice;
  positions[tokenIndex] = next;
  let captured = 0;
  if (next < 52) {
    const square = (starts[player.color] + next) % 52;
    if (!safeSquares.has(square)) for (const otherPlayer of room.players) {
      if (otherPlayer.id === player.id || (room.gameMode === "duo" && otherPlayer.teamId === player.teamId)) continue;
      const other = room.state.tokens[otherPlayer.id] || [];
      other.forEach((position, i) => {
        if (position >= 0 && position < 52 && (starts[otherPlayer.color] + position) % 52 === square) { other[i] = -1; captured++; }
      });
    }
  }
  return captured;
}
async function roomRequest(env: Env, code: string, path: string, init?: RequestInit) {
  const stub = env.LUDO_ROOMS.get(env.LUDO_ROOMS.idFromName(code));
  return stub.fetch("https://room" + path, init);
}
export class LudoRoom {
  constructor(private state: DurableObjectState, private env: Env) {}
  async fetch(request: Request) {
    const url = new URL(request.url);
    try {
      if (url.pathname === "/create" && request.method === "POST") {
        const room = await request.json<Room>();
        if (await this.state.storage.get("room")) return fail("Room code already exists.", 409);
        await this.state.storage.put("room", room);
        return json({ room });
      }
      if (url.pathname === "/read") {
        const room = await this.state.storage.get<Room>("room");
        if (!room) return fail("Room not found. Check the code and try again.", 404);
        if (url.searchParams.get("spectate") === "1") return json({ spectator: true, room: { code: room.code, status: room.status, players: room.players.map(p => ({ id: p.id, name: p.name, color: p.color })), state: room.state, createdAt: room.createdAt } });
        return json({ room });
      }
      if (url.pathname === "/action" && request.method === "POST") return this.action(await request.json<{ action: string; input: Record<string, unknown> }>());
      return fail("Not found.", 404);
    } catch (error) { return fail(error instanceof Error ? error.message : "Unexpected error.", Number((error as any)?.status) || 500); }
  }
  private async getRoom() {
    const room = await this.state.storage.get<Room>("room");
    if (!room) throw Object.assign(new Error("Room not found."), { status: 404 });
    return room;
  }
  private async broadcast(type: string, id: string, data: unknown) {
    const hub = this.env.REALTIME_HUB.get(this.env.REALTIME_HUB.idFromName("global"));
    await hub.fetch("https://hub/broadcast", { method: "POST", body: JSON.stringify({ v: 1, type: "entity.update", payload: { entity_type: type, entity_id: id, data } }) });
  }
  private async save(room: Room, beforeState?: string) {
    const nextVersion = room.version + 1;
    if (beforeState !== undefined && beforeState !== JSON.stringify([room.state, room.status])) {
      room.replaySnapshots = [...(room.replaySnapshots || []), { version: nextVersion, at: Date.now(), turnMessage: room.state.turnMessage, currentTurnIndex: room.state.currentTurnIndex, dice: room.state.dice, tokens: structuredClone(room.state.tokens), winner: room.state.winner, winnerTeam: room.state.winnerTeam }].slice(-180);
    }
    room.version = nextVersion; room.lastActivity = Date.now();
    await this.state.storage.put("room", room);
    await this.broadcast("room", room.code, { room });
    return json({ room });
  }
  private async action(body: { action: string; input: Record<string, unknown> }) {
    const room = await this.getRoom();
    const input = body.input || {};
    const beforeState = JSON.stringify([room.state, room.status]);
    const playerId = clean(input.playerId);
    const action = body.action;
    if (action === "join") {
      const name = nameOf(input.name);
      if (room.players.some(p => p.id === playerId)) return json({ room });
      if (room.status !== "waiting") return fail("This match has already started.", 409);
      const cap = room.gameMode === "one-v-one" ? 2 : 4;
      if (room.players.length >= cap) return fail("This room is full.", 409);
      const color = room.gameMode === "one-v-one" ? "yellow" : colors[room.players.length];
      room.players.push({ id: playerId, name, color, host: false, joinedAt: Date.now(), teamId: room.gameMode === "duo" ? (color === "red" || color === "yellow" ? "sun" : "moon") : undefined });
      room.state.turnMessage = name + " joined the room.";
      return this.save(room, beforeState);
    }
    if (action === "start") {
      const index = requirePlayer(room, playerId);
      if (!room.players[index].host) return fail("Only the room host can start the match.", 403);
      if (room.status !== "waiting") return fail("This match has already started.", 409);
      if (room.gameMode === "one-v-one" && room.players.length !== 2) return fail("1v1 needs exactly two players.");
      if (room.gameMode === "duo" && room.players.length !== 4) return fail("2v2 needs all four players.");
      if (room.players.length < 2 && room.mode !== "computer") return fail("Invite at least one more player.");
      room.status = "playing"; room.state = newState(room.players, room.players[0].name + " goes first. Roll the dice!");
      return this.save(room);
    }
    if (action === "roll") {
      const index = requirePlayer(room, playerId);
      if (room.status !== "playing") return fail("The match is not active.");
      if (index !== room.state.currentTurnIndex) return fail("It is not your turn yet.", 403);
      if (room.state.dice !== null) return fail("Move a token or pass before rolling again.");
      const dice = Math.floor(Math.random() * 6) + 1;
      room.state.lastRoll = dice;
      if (dice === 6 && room.state.consecutiveSixes >= 2) {
        room.state.dice = null; room.state.consecutiveSixes = 0; room.state.currentTurnIndex = nextPlayer(room, index);
        room.state.turnMessage = "Three sixes! " + room.players[room.state.currentTurnIndex].name + " gets the next turn.";
      } else {
        room.state.dice = dice; room.state.consecutiveSixes = dice === 6 ? room.state.consecutiveSixes + 1 : 0;
        room.state.turnMessage = room.players[index].name + " rolled a " + dice + ".";
      }
      return this.save(room);
    }
    if (action === "move") {
      const index = requirePlayer(room, playerId);
      if (room.status !== "playing" || index !== room.state.currentTurnIndex) return fail("It is not your active turn.", 403);
      const tokenIndex = Number(input.tokenIndex), dice = room.state.dice;
      if (!Number.isInteger(tokenIndex) || tokenIndex < 0 || tokenIndex > 3) return fail("Choose one of your four tokens.");
      if (dice === null) return fail("Roll the dice before moving.");
      const player = room.players[index], captured = moveToken(room, player, tokenIndex, dice);
      const playerWon = room.state.tokens[player.id].every(p => p === 57);
      const teamWon = room.gameMode === "duo" && room.players.filter(p => p.teamId === player.teamId).every(p => room.state.tokens[p.id].every(n => n === 57));
      if (playerWon || teamWon) {
        room.status = "finished"; room.state.winner = player.id; room.state.winnerTeam = teamWon ? player.teamId || null : null; room.state.dice = null;
        room.state.turnMessage = teamWon ? "Team " + player.teamId + " wins!" : player.name + " wins the game!";
      } else if (dice === 6) {
        room.state.dice = null; room.state.turnMessage = captured ? player.name + " captured a token and gets another roll!" : player.name + " rolled a six and gets another roll!";
      } else {
        room.state.dice = null; room.state.currentTurnIndex = nextPlayer(room, index);
        room.state.turnMessage = room.players[room.state.currentTurnIndex].name + " is up next.";
      }
      return this.save(room);
    }
    if (action === "pass") {
      const index = requirePlayer(room, playerId), dice = room.state.dice;
      if (index !== room.state.currentTurnIndex || dice === null) return fail("You cannot pass right now.");
      if (validMoves(room, playerId, dice).length) return fail("You still have a legal move.");
      room.state.dice = null; room.state.consecutiveSixes = 0; room.state.currentTurnIndex = nextPlayer(room, index);
      room.state.turnMessage = "No legal move. " + room.players[room.state.currentTurnIndex].name + " is up next.";
      return this.save(room);
    }
    if (action === "bot/turn") {
      const expected = Number(input.expectedActionVersion || 0);
      if (room.status !== "playing") return fail("The match is not active.");
      const bot = room.players[room.state.currentTurnIndex];
      if (!bot?.isBot || room.mode !== "computer") return fail("It is not a computer turn.", 403);
      const version = room.state.botActionVersion || 0;
      if (expected !== version) return fail("Computer turn already processed.", 409);
      room.state.botActionVersion = version + 1;
      const dice = Math.floor(Math.random() * 6) + 1;
      room.state.lastRoll = dice;
      if (dice === 6 && room.state.consecutiveSixes >= 2) {
        room.state.dice = null; room.state.consecutiveSixes = 0; room.state.currentTurnIndex = nextPlayer(room, room.state.currentTurnIndex);
        room.state.turnMessage = "Three sixes! " + room.players[room.state.currentTurnIndex].name + " gets the next turn.";
      } else {
        room.state.consecutiveSixes = dice === 6 ? room.state.consecutiveSixes + 1 : 0;
        const moves = validMoves(room, bot.id, dice);
        if (!moves.length) {
          room.state.dice = null; room.state.consecutiveSixes = 0; room.state.currentTurnIndex = nextPlayer(room, room.state.currentTurnIndex);
          room.state.turnMessage = bot.name + " rolled a " + dice + " but has no legal move.";
        } else {
          const token = moves.find(i => room.state.tokens[bot.id][i] === -1) ?? moves[moves.length - 1];
          const captured = moveToken(room, bot, token, dice);
          if (room.state.tokens[bot.id].every(p => p === 57)) {
            room.status = "finished"; room.state.winner = bot.id; room.state.dice = null; room.state.turnMessage = bot.name + " wins the game!";
          } else if (dice === 6) {
            room.state.dice = null; room.state.turnMessage = captured ? bot.name + " captured a token and gets another roll!" : bot.name + " rolled a six and gets another roll!";
          } else {
            room.state.dice = null; room.state.currentTurnIndex = nextPlayer(room, room.state.currentTurnIndex);
            room.state.turnMessage = room.players[room.state.currentTurnIndex].name + " is up next.";
          }
        }
      }
      return this.save(room);
    }
    if (action === "bot/turn") {
      const index = room.state.currentTurnIndex, bot = room.players[index];
      if (room.status !== "playing" || room.mode !== "computer" || !bot?.isBot) return fail("It is not a computer turn.", 403);
      const dice = Math.floor(Math.random() * 6) + 1;
      room.state.lastRoll = dice;
      if (dice === 6 && room.state.consecutiveSixes >= 2) { room.state.consecutiveSixes = 0; room.state.currentTurnIndex = nextPlayer(room, index); room.state.turnMessage = "Three sixes! " + room.players[room.state.currentTurnIndex].name + " gets the next turn."; return this.save(room, beforeState); }
      room.state.consecutiveSixes = dice === 6 ? room.state.consecutiveSixes + 1 : 0;
      const legal = validMoves(room, bot.id, dice);
      if (!legal.length) { room.state.consecutiveSixes = 0; room.state.currentTurnIndex = nextPlayer(room, index); room.state.turnMessage = bot.name + " rolled " + dice + " but has no legal move. " + room.players[room.state.currentTurnIndex].name + " is up next."; return this.save(room, beforeState); }
      const positions = room.state.tokens[bot.id];
      const chosen = legal.sort((a,b) => (positions[b] === -1 ? 24 : positions[b] + dice) - (positions[a] === -1 ? 24 : positions[a] + dice))[0];
      const captured = moveToken(room, bot, chosen, dice);
      if (room.state.tokens[bot.id].every(p => p === 57)) { room.status = "finished"; room.state.winner = bot.id; room.state.turnMessage = bot.name + " wins the game!"; }
      else if (dice === 6) room.state.turnMessage = captured ? bot.name + " captured a token and gets another roll!" : bot.name + " rolled a six and gets another roll!";
      else { room.state.currentTurnIndex = nextPlayer(room, index); room.state.turnMessage = room.players[room.state.currentTurnIndex].name + " is up next."; }
      return this.save(room, beforeState);
    }
    if (action === "chat") {
      const index = requirePlayer(room, playerId), text = clean(input.text, 140);
      if (!text) return fail("Write a message first.");
      const player = room.players[index];
      room.messages.push({ id: crypto.randomUUID(), playerId, name: player.name, color: player.color, text, kind: input.kind === "reaction" ? "reaction" : "chat", createdAt: Date.now() });
      room.messages = room.messages.slice(-40);
      return this.save(room);
    }
    if (action === "private-chat" || action === "private-chat/list") {
      const peerId = clean(action === "private-chat" ? input.toPlayerId : input.peerId);
      requirePlayer(room, playerId); requirePlayer(room, peerId);
      const peer = room.players.find(p => p.id === peerId);
      if (peerId === playerId || peer?.isBot) return fail("Choose another human player for private chat.");
      const key = "dm:" + [playerId, peerId].sort().join(":");
      const messages = await this.state.storage.get<any[]>(key) || [];
      if (action === "private-chat/list") return json({ messages: messages.slice(-40) });
      const text = clean(input.text, 140);
      if (!text) return fail("Write a message first.");
      const sender = room.players.find(p => p.id === playerId)!;
      const message = { id: crypto.randomUUID(), playerId, name: sender.name, color: sender.color, text, kind: "chat", createdAt: Date.now(), recipientId: peerId };
      messages.push(message); await this.state.storage.put(key, messages.slice(-80));
      await this.broadcast("private-chat", room.code + "_" + playerId, { message });
      await this.broadcast("private-chat", room.code + "_" + peerId, { message });
      return json({ message });
    }
    if (action === "signal") {
      const toPlayerId = clean(input.toPlayerId), signal = input.signal as any;
      requirePlayer(room, playerId);
      if (!room.callParticipants.includes(playerId) || !room.callParticipants.includes(toPlayerId)) return fail("Both players must join the live call first.", 403);
      if (!room.players.some(p => p.id === toPlayerId)) return fail("Player not found.", 404);
      if (!signal || !["offer", "answer", "ice"].includes(signal.type) || JSON.stringify(signal).length > 30000) return fail("Invalid call signal.");
      await this.broadcast("call-signal", room.code, { fromPlayerId: playerId, toPlayerId, signal });
      return json({ sent: true });
    }
    if (action === "call/join" || action === "call/leave") {
      requirePlayer(room, playerId);
      room.callParticipants = action === "call/join" ? Array.from(new Set([...room.callParticipants, playerId])) : room.callParticipants.filter(id => id !== playerId);
      return this.save(room);
    }
    if (action === "leave") {
      const index = requirePlayer(room, playerId);
      room.players = room.players.filter(p => p.id !== playerId);
      room.callParticipants = room.callParticipants.filter(id => id !== playerId);
      delete room.state.tokens[playerId];
      if (!room.players.length) { await this.state.storage.deleteAll(); await this.broadcast("room", room.code, { room: null, closed: true }); return json({ closed: true }); }
      if (index < room.state.currentTurnIndex) room.state.currentTurnIndex -= 1;
      else if (index === room.state.currentTurnIndex) room.state.currentTurnIndex %= room.players.length;
      if (!room.players.some(p => p.host)) room.players[0].host = true;
      room.state.turnMessage = "A player left the room.";
      return this.save(room);
    }
    return fail("This action is not migrated yet.", 501);
  }
}
export class RealtimeHub {
  constructor(private state: DurableObjectState) {}
  async fetch(request: Request) {
    const url = new URL(request.url);
    if (url.pathname === "/connect") {
      const connectionId = clean(url.searchParams.get("connection_id"));
      if (!connectionId) return fail("connection_id is required.");
      const pair = new WebSocketPair();
      this.state.acceptWebSocket(pair[1]);
      pair[1].serializeAttachment({ connectionId, subscriptions: [] as Array<{ type: string; id: string }> });
      return new Response(null, { status: 101, webSocket: pair[0] });
    }
    if (request.method !== "POST") return fail("Not found.", 404);
    const body = await request.json<any>();
    if (url.pathname === "/subscribe" || url.pathname === "/unsubscribe") {
      for (const socket of this.state.getWebSockets()) {
        const meta = socket.deserializeAttachment() as any;
        if (meta?.connectionId !== body.connection_id) continue;
        const exists = meta.subscriptions.some((s: any) => s.type === body.entity_type && s.id === body.entity_id);
        if (url.pathname === "/subscribe" && !exists) meta.subscriptions.push({ type: body.entity_type, id: body.entity_id });
        if (url.pathname === "/unsubscribe") meta.subscriptions = meta.subscriptions.filter((s: any) => s.type !== body.entity_type || s.id !== body.entity_id);
        socket.serializeAttachment(meta);
      }
      return json({ ok: true });
    }
    if (url.pathname === "/broadcast") {
      let delivered = 0;
      for (const socket of this.state.getWebSockets()) {
        const meta = socket.deserializeAttachment() as any;
        if (meta?.subscriptions?.some((s: any) => s.type === body.payload?.entity_type && s.id === body.payload?.entity_id)) {
          try { socket.send(JSON.stringify(body)); delivered++; } catch { /* closed socket */ }
        }
      }
      return json({ delivered });
    }
    return fail("Not found.", 404);
  }
}
function withCors(response: Response, origin: string) {
  const headers = new Headers(response.headers);
  headers.set("access-control-allow-origin", origin);
  headers.set("access-control-allow-methods", "GET,POST,OPTIONS");
  headers.set("access-control-allow-headers", "Content-Type,Authorization");
  headers.set("vary", "Origin");
  return new Response(response.body, { status: response.status, headers });
}
export default {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url), origin = env.ALLOWED_ORIGIN || request.headers.get("origin") || "*";
    if (request.method === "OPTIONS") return withCors(new Response(null, { status: 204 }), origin);
    try {
      if (url.pathname === "/connect") { const hub = env.REALTIME_HUB.get(env.REALTIME_HUB.idFromName("global")); return hub.fetch("https://hub/connect" + url.search); }
      if (url.pathname === "/api/_healthcheck") return withCors(json({ message: "Success", platform: "cloudflare-workers" }), origin);
      if (url.pathname === "/connect") {
        const hub = env.REALTIME_HUB.get(env.REALTIME_HUB.idFromName("global"));
        const target = new URL("https://hub/connect");
        target.searchParams.set("connection_id", url.searchParams.get("connection_id") || "");
        return hub.fetch(new Request(target, request));
      }
      if (url.pathname === "/api/subscriptions" || url.pathname === "/api/subscriptions/remove") {
        const body = await request.json();
        const hub = env.REALTIME_HUB.get(env.REALTIME_HUB.idFromName("global"));
        return withCors(await hub.fetch("https://hub/" + (url.pathname.endsWith("/remove") ? "unsubscribe" : "subscribe"), { method: "POST", body: JSON.stringify(body) }), origin);
      }
      if (url.pathname === "/api/rooms" || url.pathname === "/api/rooms/computer") {
        if (request.method !== "POST") return withCors(fail("Method not allowed.", 405), origin);
        const input = await request.json<any>(), playerId = clean(input.playerId);
        if (!playerId) return withCors(fail("Player session is missing."), origin);
        const name = nameOf(input.name), gameMode = ["one-v-one", "duo"].includes(input.gameMode) ? input.gameMode : "classic";
        const code = newCode(), mode = url.pathname.endsWith("/computer") ? "computer" : "friends", now = Date.now();
        const players: Player[] = [{ id: playerId, name, color: "red", host: true, joinedAt: now, teamId: gameMode === "duo" ? "sun" : undefined }];
        let status: Room["status"] = "waiting";
        if (mode === "computer") {
          const count = Math.min(3, Math.max(1, Number(input.botCount) || 3));
          for (let i = 0; i < count; i++) players.push({ id: "cpu-" + code + "-" + i, name: ["Nova CPU", "Atlas CPU", "Pixel CPU"][i], color: colors[i + 1], host: false, joinedAt: now, isBot: true });
          status = "playing";
        }
        const room: Room = { id: code, code, players, status, mode, gameMode, state: status === "playing" ? newState(players, name + " goes first. Roll the dice!") : { currentTurnIndex: 0, dice: null, consecutiveSixes: 0, tokens: {}, winner: null, winnerTeam: null, turnMessage: "Waiting for players to join.", lastRoll: null }, messages: [], callParticipants: [], version: 1, createdAt: now, lastActivity: now, replaySnapshots: [] };
        const stub = env.LUDO_ROOMS.get(env.LUDO_ROOMS.idFromName(code));
        return withCors(await stub.fetch("https://room/create", { method: "POST", body: JSON.stringify(room) }), origin);
      }
      const parts = url.pathname.split("/").filter(Boolean);
      if (parts[0] === "api" && parts[1] === "rooms" && parts[2]) {
        const code = parts[2].toUpperCase();
        if (!/^[A-Z0-9]{6}$/.test(code)) return withCors(fail("Enter a valid 6-character room code."), origin);
        const suffix = parts.slice(3).join("/");
        const stub = env.LUDO_ROOMS.get(env.LUDO_ROOMS.idFromName(code));
        if (request.method === "GET" && !suffix) return withCors(await stub.fetch("https://room/read"), origin);
        if (request.method === "GET" && suffix === "spectate") return withCors(await stub.fetch("https://room/read?spectate=1"), origin);
        if (request.method === "POST") return withCors(await stub.fetch("https://room/action", { method: "POST", body: JSON.stringify({ action: suffix, input: await request.json() }) }), origin);
      }
      if (request.method === "GET" && parts[0] === "api" && parts[1] === "rooms" && parts[2] && parts[3] === "replay") { const roomCode = parts[2].toUpperCase(); const roomRes = await stub.fetch("https://room/read"); const payload = await roomRes.json<any>(); const room = payload.room as Room | undefined; if (!room || room.status !== "finished") return withCors(fail("Replay is available after a match has finished.", 404), origin); return withCors(json({ roomCode, completedAt: room.lastActivity, gameMode: room.gameMode, players: room.players, winnerId: room.state.winner, winnerTeam: room.state.winnerTeam || null, events: room.replaySnapshots || [] }), origin); }
      if (url.pathname === "/api/matchmaking/join" || url.pathname === "/api/matchmaking/status" || url.pathname === "/api/matchmaking/cancel") return withCors(fail("Matchmaking lobby is the next migration module.", 503), origin);
      return withCors(fail("This API route is not migrated yet.", 501), origin);
    } catch (error) { return withCors(fail(error instanceof Error ? error.message : "Unexpected server error.", 500), origin); }
  }
};
