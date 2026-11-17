import { db, error, json, type RouterContext } from '@appdeploy/sdk';

type TournamentPlayer = { id: string; name: string; joinedAt: number };
type TournamentMatch = {
  id: string;
  round: number;
  firstPlayerId: string;
  secondPlayerId: string | null;
  winnerId: string | null;
  roomCode?: string;
};
type Tournament = {
  id: string;
  name: string;
  hostId: string;
  hostName: string;
  format: 'single-elimination';
  maxPlayers: number;
  status: 'open' | 'live' | 'completed';
  players: TournamentPlayer[];
  matches: TournamentMatch[];
  championId?: string;
  createdAt: number;
  updatedAt: number;
};
type MatchRecord = {
  id: string;
  roomCode: string;
  winnerId: string;
  players: Array<{ id: string; name: string }>;
  completedAt: number;
  createdAt?: number;
};
type Ctx = RouterContext;

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

async function getTournament(id: string) {
  const [item] = await db.get<Tournament>('ludo_tournaments', [safeId(id)], { consistent: true });
  if (!item) fail('Tournament not found.', 404);
  return item;
}

function advanceBracket(tournament: Tournament) {
  const currentRound = Math.max(0, ...tournament.matches.map(match => match.round));
  const current = tournament.matches.filter(match => match.round === currentRound);
  if (!current.length || current.some(match => !match.winnerId)) return;
  const winners = current.map(match => match.winnerId as string);
  if (winners.length === 1) {
    tournament.status = 'completed';
    tournament.championId = winners[0];
    return;
  }
  const nextRound = currentRound + 1;
  const next: TournamentMatch[] = [];
  for (let index = 0; index < winners.length; index += 2) {
    next.push({
      id: 'R' + nextRound + 'M' + (next.length + 1),
      round: nextRound,
      firstPlayerId: winners[index],
      secondPlayerId: winners[index + 1] || null,
      winnerId: winners[index + 1] ? null : winners[index],
    });
  }
  tournament.matches.push(...next);
  if (next.every(match => match.winnerId)) advanceBracket(tournament);
}

export const competitionRoutes = {
  'GET /api/tournaments': route(async () => {
    const { items } = await db.list<Tournament>('ludo_tournaments', { limit: 100 });
    return { tournaments: items.sort((a, b) => b.createdAt - a.createdAt).slice(0, 40) };
  }),

  'POST /api/tournaments': route(async ({ body }) => {
    const input = (body || {}) as Record<string, unknown>;
    const hostId = clean(input.playerId);
    const hostName = clean(input.playerName, 18);
    const name = clean(input.name, 42);
    const maxPlayers = Number(input.maxPlayers);
    if (!hostId || !hostName) fail('Set your player name before creating a tournament.');
    if (name.length < 3) fail('Tournament name must be at least 3 characters.');
    if (![4, 8, 16].includes(maxPlayers)) fail('Choose a tournament size of 4, 8 or 16 players.');
    const now = Date.now();
    const id = 'T' + now.toString(36).toUpperCase() + Math.random().toString(36).slice(2, 7).toUpperCase();
    const tournament: Tournament = {
      id, name, hostId, hostName, format: 'single-elimination', maxPlayers,
      status: 'open',
      players: [{ id: hostId, name: hostName, joinedAt: now }],
      matches: [], createdAt: now, updatedAt: now,
    };
    const [created] = await db.tx.add('ludo_tournaments', [tournament]);
    if (!created) fail('Could not create the tournament. Please try again.', 503);
    return { tournament };
  }),

  'POST /api/tournaments/:id/join': route(async ({ params, body }) => {
    const input = (body || {}) as Record<string, unknown>;
    const playerId = clean(input.playerId);
    const playerName = clean(input.playerName, 18);
    if (!playerId || !playerName) fail('Set your player name before joining.');
    const tournament = await getTournament(params.id);
    if (tournament.status !== 'open') fail('This tournament is no longer accepting players.', 409);
    if (tournament.players.some(player => player.id === playerId)) return { tournament };
    if (tournament.players.length >= tournament.maxPlayers) fail('This tournament is full.', 409);
    tournament.players.push({ id: playerId, name: playerName, joinedAt: Date.now() });
    tournament.updatedAt = Date.now();
    const [updated] = await db.tx.update('ludo_tournaments', [{
      id: tournament.id, record: { players: tournament.players, updatedAt: tournament.updatedAt },
      if: { status: 'open' },
    }], { patch: true });
    if (!updated) fail('The tournament changed. Refresh and try again.', 409);
    return { tournament };
  }),

  'POST /api/tournaments/:id/leave': route(async ({ params, body }) => {
    const playerId = clean((body as Record<string, unknown> | undefined)?.playerId);
    const tournament = await getTournament(params.id);
    if (tournament.status !== 'open') fail('A started tournament cannot be left from its bracket.', 409);
    if (tournament.hostId === playerId) fail('The host cannot leave. Close the tournament or transfer hosting later.', 409);
    tournament.players = tournament.players.filter(player => player.id !== playerId);
    tournament.updatedAt = Date.now();
    await db.tx.update('ludo_tournaments', [{ id: tournament.id, record: { players: tournament.players, updatedAt: tournament.updatedAt } }], { patch: true });
    return { tournament };
  }),

  'POST /api/tournaments/:id/start': route(async ({ params, body }) => {
    const playerId = clean((body as Record<string, unknown> | undefined)?.playerId);
    const tournament = await getTournament(params.id);
    if (tournament.hostId !== playerId) fail('Only the tournament host can start it.', 403);
    if (tournament.status !== 'open') fail('This tournament has already started.', 409);
    if (tournament.players.length < 2) fail('Invite at least one more player first.');
    const shuffled = [...tournament.players].sort(() => Math.random() - 0.5);
    tournament.matches = [];
    for (let index = 0; index < shuffled.length; index += 2) {
      tournament.matches.push({
        id: 'R1M' + (tournament.matches.length + 1), round: 1,
        firstPlayerId: shuffled[index].id,
        secondPlayerId: shuffled[index + 1]?.id || null,
        winnerId: shuffled[index + 1] ? null : shuffled[index].id,
      });
    }
    tournament.status = 'live';
    tournament.updatedAt = Date.now();
    advanceBracket(tournament);
    await db.tx.update('ludo_tournaments', [{
      id: tournament.id,
      record: { matches: tournament.matches, status: tournament.status, championId: tournament.championId || null, updatedAt: tournament.updatedAt },
      if: { status: 'open' },
    }], { patch: true });
    return { tournament };
  }),

  'POST /api/tournaments/:id/report-result': route(async ({ params, body }) => {
    const input = (body || {}) as Record<string, unknown>;
    const playerId = clean(input.playerId);
    const roomCode = clean(input.roomCode, 6).toUpperCase();
    const tournament = await getTournament(params.id);
    if (tournament.status !== 'live') fail('This tournament is not live.', 409);
    if (!tournament.players.some(player => player.id === playerId)) fail('You are not registered in this tournament.', 403);
    const [room] = await db.get<MatchRecord>('ludo_results', [roomCode], { consistent: true });
    if (!room || !room.winnerId) fail('Submit a completed Ludo Live match room.', 409);
    const match = tournament.matches.find(item =>
      !item.winnerId && [item.firstPlayerId, item.secondPlayerId].includes(playerId) &&
      room.players.some(player => player.id === item.firstPlayerId) &&
      room.players.some(player => player.id === item.secondPlayerId)
    );
    if (!match) fail('That finished match does not match an open fixture in this tournament.', 409);
    if (![match.firstPlayerId, match.secondPlayerId].includes(room.winnerId)) fail('The recorded winner is not in this tournament fixture.', 409);
    match.winnerId = room.winnerId;
    match.roomCode = roomCode;
    advanceBracket(tournament);
    tournament.updatedAt = Date.now();
    await db.tx.update('ludo_tournaments', [{
      id: tournament.id,