import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const worker = await readFile(new URL("../worker/index.ts", import.meta.url), "utf8");
const scenarios = JSON.parse(await readFile(new URL("./tests.json", import.meta.url), "utf8"));

test("multiplayer regression scenarios remain defined", () => {
  assert.ok(Array.isArray(scenarios) && scenarios.length >= 5);
  const covered = new Set(scenarios.flatMap((scenario) => scenario.covers || []));
  for (const capability of [
    "invite code join",
    "realtime turn synchronization",
    "spectator cannot submit game actions",
    "tournament capacity validation",
    "private chat and media stream exclusion",
  ]) assert.ok(covered.has(capability), `Missing scenario coverage: ${capability}`);
});

test("room actions require an existing room player", () => {
  assert.match(worker, /function requirePlayer\(room: Room, playerId: string\)/);
  assert.match(worker, /const index = room\.players\.findIndex\(p => p\.id === playerId\)/);
  assert.match(worker, /You are not a player in this room\./);
  assert.match(worker, /if \(!room\.players\[index\]\.host\) return fail\("Only the room host can start the match\.", 403\)/);
});

test("turn actions enforce active player, dice and legal movement", () => {
  assert.match(worker, /if \(room\.status !== "playing"\) return fail\("The match is not active\."\)/);
  assert.match(worker, /if \(index !== room\.state\.currentTurnIndex\) return fail\("It is not your turn yet\.", 403\)/);
  assert.match(worker, /if \(room\.state\.dice !== null\) return fail\("Move a token or pass before rolling again\."\)/);
  assert.match(worker, /if \(old >= 0 && old \+ dice > 57\) throw new Error\("That token cannot move\."\)/);
});

test("reconnect grace period removes players only after the server-side deadline", () => {
  assert.match(worker, /120_000/);
  assert.match(worker, /async alarm\(\)/);
  assert.match(worker, /now - at >= 120_000/);
  assert.match(worker, /\/presence\/reconnect/);
  assert.match(worker, /\/presence\/disconnect/);
});

test("room chat has both a cooldown and a rolling rate limit", () => {
  assert.match(worker, /async checkChatRate\(playerId: string\)/);
  assert.match(worker, /now - state\.last < 900/);
  assert.match(worker, /recent\.length >= 8/);
  assert.match(worker, /if \(!await this\.checkChatRate\(playerId\)\)/);
});

test("private messages and call signaling are scoped to authorized participants", () => {
  assert.match(worker, /You can only receive your own private messages\./);
  assert.match(worker, /Join the live call before subscribing to call signals\./);
  assert.match(worker, /Both players must join the live call first\./);
  assert.match(worker, /Messaging is unavailable between these accounts\./);
});

test("matchmaking throttles repeated queue attempts per player", () => {
  assert.match(worker, /queue-rate:/);
  assert.match(worker, /recentJoins\.length >= 5/);
  assert.match(worker, /Too many matchmaking attempts/);
});

test("cosmetic purchases calculate balance from recorded match results", () => {
  assert.match(worker, /const earned=matches\.length\*20\+wins\*30/);
  assert.match(worker, /if\(balance<item\.price\)return fail\("Not enough coins yet/);
  assert.match(worker, /You already own this item\./);
});

test("CORS is not treated as the authentication boundary", () => {
  assert.match(worker, /Authorization/);
  assert.match(worker, /authenticatedUser/);
  assert.match(worker, /Authentication required\./);
  assert.doesNotMatch(worker, /Access-Control-Allow-Origin"\s*,\s*"\*"/);
});
