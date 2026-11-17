import { db, error, isAppDatabaseError, json, type RouterContext } from '@appdeploy/sdk';
import { notifySubscribers } from './realtime-subscribers';

type PlayerColor = 'red' | 'blue' | 'yellow' | 'green';
type Player = {
  id: string;
  name: string;
  color: PlayerColor;
  host: boolean;
  joinedAt: number;
  isBot?: boolean;
  teamId?: 'sun' | 'moon';
};
type ChatMessage = {
  id: string;
  playerId: string;
  name: string;
  color: PlayerColor;
  text: string;
  kind: 'chat' | 'reaction';
  createdAt: number;
};
type PrivateChatMessage = ChatMessage & { recipientId: string };
type GameState = {
  currentTurnIndex: number;
  dice: number | null;
  consecutiveSixes: number;
  tokens: Record<string, number[]>;
  winner: string | null;
  winnerTeam?: 'sun' | 'moon' | null;
  turnMessage: string;
  lastRoll: number | null;
  botActionVersion?: number;
};
type Room = {
  id: string;
  code: string;
  players: Player[];
  status: 'waiting' | 'playing' | 'finished';
  state: GameState;
  messages: ChatMessage[];
  callParticipants?: string[];
  mode?: 'friends' | 'computer' | 'random';
  gameMode?: 'classic' | 'one-v-one' | 'duo';
  replaySnapshots?: Array<{ version: number; at: number; turnMessage: string; currentTurnIndex: number; dice: number | null; tokens: Record<string, number[]>; winner: string | null; winnerTeam?: 'sun' | 'moon' | null }>;
  version: number;
  createdAt: number;
  lastActivity: number;
};
type MatchQueueRecord = {
  id: string;
  recordType: 'matchmaking_queue';
  playerId: string;
  name: string;
  status: 'waiting' | 'matched' | 'cancelled' | 'expired';
  joinedAt: number;
  roomCode?: string;
  matchedWith?: string;
  matchedAt?: number;
};
type Body = Record<string, unknown>;

class HttpError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

const COLORS: PlayerColor[] = ['red', 'blue', 'yellow', 'green'];
const START_INDEX: Record<PlayerColor, number> = {
  red: 1,
  blue: 14,
  yellow: 27,
  green: 40,
};
const SAFE_SQUARES = new Set([1, 9, 14, 22, 27, 35, 40, 48]);
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function textValue(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value.trim() : fallback;
}

function safeName(value: unknown): string {
  const name = textValue(value).replace(/\s+/g, ' ').slice(0, 18);
  if (!name) throw new HttpError('Enter a player name first.');
  return name;
}

function makeCode(): string {
  let code = '';
  for (let index = 0; index < 6; index += 1) {
    code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  }
  return code;
}

function getPlayerIndex(room: Room, playerId: string): number {
  const index = room.players.findIndex(player => player.id === playerId);
  if (index < 0) throw new HttpError('You are not a player in this room.', 403);
  return index;
}

function privateChatTable(roomCode: string, firstPlayerId: string, secondPlayerId: string): string {
  const pairKey = [firstPlayerId, secondPlayerId]
    .sort()
    .map(id => id.replace(/[^a-zA-Z0-9]/g, '').slice(0, 24))
    .join('_');
  return 'ludo_dm_' + roomCode + '_' + pairKey;
}

async function getRoom(code: string): Promise<Room> {
  const normalized = code
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 6);
  if (normalized.length !== 6)
    throw new HttpError('Enter a valid 6-character room code.');
  const [room] = await db.get<Room>('ludo_rooms', [normalized], {
    consistent: true,
  });
  if (!room)
    throw new HttpError('Room not found. Check the code and try again.', 404);
  return room;
}

async function mutateRoom(
  code: string,
  mutate: (room: Room) => void
): Promise<Room> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const room = await getRoom(code);
    room.callParticipants = room.callParticipants || [];
    const stateBefore = JSON.stringify(room.state);
    const statusBefore = room.status;
    mutate(room);
    const nextVersion = room.version + 1;
    const gameChanged = stateBefore !== JSON.stringify(room.state) || statusBefore !== room.status;
    if (gameChanged) {
      room.replaySnapshots = [...(room.replaySnapshots || []), {
        version: nextVersion,
        at: Date.now(),
        turnMessage: room.state.turnMessage,
        currentTurnIndex: room.state.currentTurnIndex,
        dice: room.state.dice,
        tokens: room.state.tokens,
        winner: room.state.winner,
        winnerTeam: room.state.winnerTeam || null,
      }].slice(-180);
    }
    const nextActivity = Date.now();
    const [updated] = await db.tx.update(
      'ludo_rooms',
      [
        {
          id: room.id,
          record: {
            players: room.players,
            status: room.status,
            state: room.state,
            messages: room.messages,
            callParticipants: room.callParticipants || [],
            replaySnapshots: room.replaySnapshots || [],
            version: nextVersion,
            lastActivity: nextActivity,
          },
          if: { version: room.version },
        },
      ],
      { patch: true }
    );
    if (updated) {
      room.version = nextVersion;
      room.lastActivity = nextActivity;
      await notifySubscribers('room', room.code, { room });
      return room;
    }
  }
  throw new HttpError(
    'The room changed just now. Please try that action again.',
    409
  );
}

function nextPlayerIndex(room: Room, currentIndex: number): number {
  return (currentIndex + 1) % room.players.length;
}

function canMove(position: number, dice: number): boolean {
  if (position === -1) return dice === 6;
  return position + dice <= 57;
}

function validMoves(room: Room, playerId: string, dice: number): number[] {
  const positions = room.state.tokens[playerId] || [-1, -1, -1, -1];
  return positions
    .map((position, index) => (canMove(position, dice) ? index : -1))
    .filter(index => index >= 0);
}