import { useEffect, useMemo, useRef, useState } from 'react';
import { api, ws } from '@appdeploy/client';
import CompetitionHub from './CompetitionHub';
import {
  ArrowRight,
  Bot,
  Check,
  ChevronRight,
  Copy,
  Crown,
  Dice5,
  DoorOpen,
  Gamepad2,
  MessageCircle,
  Mic,
  MicOff,
  Phone,
  PhoneOff,
  Video,
  VideoOff,
  Send,
  Shield,
  Shuffle,
  Sparkles,
  Trophy,
  Users,
  Flag,
  Ban,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react';

type Color = 'red' | 'blue' | 'yellow' | 'green';
type Player = {
  id: string;
  name: string;
  color: Color;
  host: boolean;
  joinedAt: number;
  isBot?: boolean;
  teamId?: 'sun' | 'moon';
};
type ChatMessage = {
  id: string;
  playerId: string;
  name: string;
  color: Color;
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
  version: number;
};
type Point = { row: number; col: number };

const COLORS: Color[] = ['red', 'blue', 'yellow', 'green'];
const COLOR_NAMES: Record<Color, string> = {
  red: 'Ruby',
  blue: 'Azure',
  yellow: 'Gold',
  green: 'Jade',
};
const START_INDEX: Record<Color, number> = {
  red: 1,
  blue: 14,
  yellow: 27,
  green: 40,
};
const SAFE_SQUARES = new Set([1, 9, 14, 22, 27, 35, 40, 48]);
const TRACK: Point[] = [
  ...Array.from({ length: 6 }, (_, index) => ({ row: 6, col: index })),
  ...Array.from({ length: 6 }, (_, index) => ({ row: 5 - index, col: 6 })),
  { row: 0, col: 7 },
  { row: 0, col: 8 },
  ...Array.from({ length: 6 }, (_, index) => ({ row: index + 1, col: 8 })),
  ...Array.from({ length: 6 }, (_, index) => ({ row: 6, col: 9 + index })),
  { row: 7, col: 14 },
  ...Array.from({ length: 5 }, (_, index) => ({ row: 8, col: 13 - index })),
  ...Array.from({ length: 6 }, (_, index) => ({ row: 9 + index, col: 8 })),
  { row: 14, col: 7 },
  { row: 14, col: 6 },
  ...Array.from({ length: 6 }, (_, index) => ({ row: 13 - index, col: 6 })),
  ...Array.from({ length: 6 }, (_, index) => ({ row: 8, col: 5 - index })),
];
const YARD: Record<Color, Point[]> = {
  red: [
    { row: 2, col: 2 },
    { row: 2, col: 4 },
    { row: 4, col: 2 },
    { row: 4, col: 4 },
  ],
  blue: [
    { row: 2, col: 10 },
    { row: 2, col: 12 },
    { row: 4, col: 10 },
    { row: 4, col: 12 },
  ],
  yellow: [
    { row: 10, col: 10 },
    { row: 10, col: 12 },
    { row: 12, col: 10 },
    { row: 12, col: 12 },
  ],
  green: [
    { row: 10, col: 2 },
    { row: 10, col: 4 },
    { row: 12, col: 2 },
    { row: 12, col: 4 },
  ],
};
const HOME_LANES: Record<Color, Point[]> = {
  red: Array.from({ length: 6 }, (_, index) => ({ row: 7, col: index + 1 })),
  blue: Array.from({ length: 6 }, (_, index) => ({ row: index + 1, col: 7 })),
  yellow: Array.from({ length: 6 }, (_, index) => ({
    row: 7,
    col: 13 - index,
  })),
  green: Array.from({ length: 6 }, (_, index) => ({ row: 13 - index, col: 7 })),
};
const DICE_FACES = ['–', '⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];

function playerIdForDevice(): string {
  const key = 'ludo-live-player-id';
  let id = localStorage.getItem(key);
  if (!id) {
    id =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : 'guest-' +
          Math.random().toString(36).slice(2) +
          Date.now().toString(36);
    localStorage.setItem(key, id);
  }
  return id;
}

function getTokenPoint(
  color: Color,
  position: number,
  tokenIndex: number
): Point {
  if (position < 0) return YARD[color][tokenIndex];
  if (position < 52) return TRACK[(START_INDEX[color] + position) % 52];
  return HOME_LANES[color][Math.min(position - 52, 5)];
}

function canMove(position: number, dice: number): boolean {
  if (position === -1) return dice === 6;
  return position + dice <= 57;
}

function getErrorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'response' in error) {
    const response = (
      error as { response?: { data?: { error?: string; message?: string } } }
    ).response;
    if (response?.data?.error) return response.data.error;
    if (response?.data?.message) return response.data.message;
  }
  return error instanceof Error
    ? error.message
    : 'Something went wrong. Please try again.';
}

function Board({
  room,
  playerId,
  onMove,
}: {
  room: Room;
  playerId: string;
  onMove: (index: number) => void;
}) {
  const currentPlayer = room.players[room.state.currentTurnIndex];
  const myTurn = currentPlayer?.id === playerId;
  const dice = room.state.dice;
  const movable = useMemo(() => {