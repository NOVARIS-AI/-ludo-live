import { db, error, json, type RouterContext } from '@appdeploy/sdk';

type Ctx = RouterContext;
type MatchResult = {
  id: string;
  roomCode: string;
  winnerId: string;
  winnerTeam?: string | null;
  gameMode?: 'classic' | 'one-v-one' | 'duo';
  players: Array<{ id: string; name: string; teamId?: string }>;
  completedAt: number;
  createdAt?: number;
  replay?: Array<{
    version: number;
    at: number;
    turnMessage: string;
    currentTurnIndex: number;
    dice: number | null;
    tokens: Record<string, number[]>;
    winner: string | null;
    winnerTeam?: string | null;
  }>;
};
type FriendRecord = {
  id: string;
  playerId: string;
  playerName: string;
  targetPlayerId: string;
  targetPlayerName: string;
  status: 'pending' | 'accepted' | 'declined';
  createdAt: number;
  updatedAt: number;
};
type ProfileRecord = { id: string; equippedCosmetic: string; updatedAt: number };

function route(handler: (ctx: Ctx) => Promise<unknown>) {
  return [async (ctx: Ctx) => {
    try {
      return json(await handler(ctx));
    } catch (caught) {
      const status = caught && typeof caught === 'object' && 'status' in caught
        ? Number((caught as { status: number }).status) : 500;
      const message = caught instanceof Error ? caught.message : 'Unexpected server error.';
      return error(message, Number.isInteger(status) && status >= 400 && status <= 599 ? status : 500);
    }
  }];
}

function clean(value: unknown, max = 80) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}
function fail(message: string, status = 400): never {
  const issue = new Error(message) as Error & { status: number };
  issue.status = status;
  throw issue;
}
function safeId(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
}
function pairId(first: string, second: string) {
  const value = [first, second].sort().join('|');
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return 'F' + (hash >>> 0).toString(36).toUpperCase();
}
function monthStart(now: number) {
  const date = new Date(now);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
}
const COSMETICS = [
  { id: 'classic', name: 'Classic', description: 'The original Ludo Live look.', winsRequired: 0 },
  { id: 'ruby-trail', name: 'Ruby trail', description: 'A subtle trail for your tokens.', winsRequired: 3 },
  { id: 'gold-dice', name: 'Golden dice', description: 'A golden dice finish.', winsRequired: 10 },
  { id: 'champion-aura', name: 'Champion aura', description: 'A special champion board accent.', winsRequired: 25 },
];

async function results() {
  const { items } = await db.list<MatchResult>('ludo_results', { limit: 1000 });
  return items;
}
async function getProgress(playerId: string) {
  const matches = (await results()).filter(match => match.players?.some(player => player.id === playerId));
  const wins = matches.filter(match =>
    match.winnerId === playerId || Boolean(match.winnerTeam && match.players.some(player => player.id === playerId && player.teamId === match.winnerTeam))
  ).length;
  const xp = matches.length * 30 + wins * 50;
  const coins = matches.length * 20 + wins * 30;
  const level = Math.floor(xp / 250) + 1;
  const id = safeId(playerId);
  const [profile] = id ? await db.get<ProfileRecord>('ludo_profiles', [id], { consistent: true }) : [null];
  const unlocked = COSMETICS.filter(item => wins >= item.winsRequired);
  const equipped = unlocked.some(item => item.id === profile?.equippedCosmetic)
    ? profile?.equippedCosmetic as string : 'classic';
  return { playerId, matchesPlayed: matches.length, wins, xp, coins, level, unlockedCosmetics: unlocked, cosmetics: COSMETICS, equippedCosmetic: equipped };
}

export const playerFeatureRoutes = {
  'GET /api/players/:playerId/progression': route(async ({ params }) => {
    const playerId = clean(params.playerId);
    if (!playerId) fail('Player ID is required.');
    return getProgress(playerId);
  }),

  'POST /api/players/:playerId/cosmetics/equip': route(async ({ params, body }) => {
    const playerId = clean(params.playerId);
    const cosmeticId = clean((body as Record<string, unknown> | undefined)?.cosmeticId, 40);
    if (!playerId || !cosmeticId) fail('Choose a cosmetic first.');
    const progress = await getProgress(playerId);
    if (!progress.unlockedCosmetics.some(item => item.id === cosmeticId)) fail('Play more matches to unlock that cosmetic.', 403);
    const id = safeId(playerId);
    await db.tx.add('ludo_profiles', [{ id, equippedCosmetic: 'classic', updatedAt: Date.now() }]);
    const [updated] = await db.tx.update('ludo_profiles', [{
      id, record: { equippedCosmetic: cosmeticId, updatedAt: Date.now() },
    }], { patch: true });
    if (!updated) fail('Could not save your cosmetic. Please try again.', 503);
    return { equippedCosmetic: cosmeticId };
  }),

  'GET /api/season/leaderboard': route(async () => {
    const now = Date.now();
    const start = monthStart(now);
    const matches = (await results()).filter(match => (match.completedAt || 0) >= start);
    const stats = new Map<string, { playerId: string; name: string; wins: number; matches: number; points: number }>();
    for (const match of matches) {
      for (const player of match.players || []) {
        const item = stats.get(player.id) || { playerId: player.id, name: player.name, wins: 0, matches: 0, points: 0 };
        item.matches += 1;
        const won = match.winnerId === player.id || Boolean(match.winnerTeam && player.teamId === match.winnerTeam && match.winnerTeam);
        if (won) item.wins += 1;
        item.points += won ? 100 : 10;
        stats.set(player.id, item);
      }
    }
    return {
      season: new Date(start).toISOString().slice(0, 7),
      resetsAt: new Date(Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth() + 1, 1)).toISOString(),
      leaderboard: [...stats.values()].sort((a, b) => b.points - a.points || b.wins - a.wins).slice(0, 50),
    };
  }),

  'GET /api/rooms/:code/replay': route(async ({ params }) => {
    const code = clean(params.code, 6).toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (code.length !== 6) fail('Enter a valid room code.');
    const [match] = await db.get<MatchResult>('ludo_results', [code], { consistent: true });
    if (!match) fail('Replay is available after a match has finished.', 404);
    return {
      roomCode: match.roomCode,
      completedAt: match.completedAt,
      gameMode: match.gameMode || 'classic',
      players: match.players,
      winnerId: match.winnerId,
      winnerTeam: match.winnerTeam || null,
      events: match.replay || [],
    };
  }),

  'GET /api/players/:playerId/friends': route(async ({ params }) => {
    const playerId = clean(params.playerId);
    if (!playerId) fail('Player ID is required.');
    const { items } = await db.list<FriendRecord>('ludo_friends', { limit: 500 });
    const related = items.filter(item => item.playerId === playerId || item.targetPlayerId === playerId);
    return {
      playerId,
      friends: related.filter(item => item.status === 'accepted').map(item => ({
        playerId: item.playerId === playerId ? item.targetPlayerId : item.playerId,
        name: item.playerId === playerId ? item.targetPlayerName : item.playerName,
      })),
      incoming: related.filter(item => item.status === 'pending' && item.targetPlayerId === playerId),
      outgoing: related.filter(item => item.status === 'pending' && item.playerId === playerId),
    };
  }),

  'POST /api/friends/request': route(async ({ body }) => {
    const input = (body || {}) as Record<string, unknown>;
    const playerId = clean(input.playerId);
    const playerName = clean(input.playerName, 18);
    const targetPlayerId = clean(input.targetPlayerId);
    const targetPlayerName = clean(input.targetPlayerName, 18);
    if (!playerId || !targetPlayerId || !playerName || !targetPlayerName) fail('Both player IDs and display names are required.');
    if (playerId === targetPlayerId) fail('You cannot add yourself as a friend.');
    const id = pairId(playerId, targetPlayerId);
    const [existing] = await db.get<FriendRecord>('ludo_friends', [id], { consistent: true });
    if (existing?.status === 'accepted') return { friendship: existing };
    if (existing?.status === 'pending') {
      if (existing.playerId === targetPlayerId && existing.targetPlayerId === playerId) {
        const [updated] = await db.tx.update('ludo_friends', [{ id, record: { status: 'accepted', updatedAt: Date.now() }, if: { status: 'pending' } }], { patch: true });
        if (!updated) fail('Friend request changed. Refresh and try again.', 409);
        return { friendship: { ...existing, status: 'accepted' } };
      }
      return { friendship: existing };
    }
    const friendship: FriendRecord = {
      id, playerId, playerName, targetPlayerId, targetPlayerName,
      status: 'pending', createdAt: Date.now(), updatedAt: Date.now(),
    };
    const [created] = await db.tx.add('ludo_friends', [friendship]);
    if (!created) fail('A friend request already exists. Refresh your friends list.', 409);