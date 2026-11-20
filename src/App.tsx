import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { ws } from './lib/realtime';
import { api, setAuthToken } from './lib/api';
import CompetitionHub from './CompetitionHub';
import Store from './Store';
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
  ShoppingBag,
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
    if (!myTurn || dice === null) return [];
    const positions = room.state.tokens[playerId] || [-1, -1, -1, -1];
    return positions
      .map((position, index) => (canMove(position, dice) ? index : -1))
      .filter(index => index >= 0);
  }, [room, playerId, myTurn, dice]);
  const tokensAt = new Map<
    string,
    Array<{ player: Player; index: number; movable: boolean }>
  >();
  room.players.forEach(player => {
    const positions = room.state.tokens[player.id] || [-1, -1, -1, -1];
    positions.forEach((position, index) => {
      const point = getTokenPoint(player.color, position, index);
      const key = point.row + '-' + point.col;
      const group = tokensAt.get(key) || [];
      group.push({
        player,
        index,
        movable: player.id === playerId && movable.includes(index),
      });
      tokensAt.set(key, group);
    });
  });
  const trackLookup = new Map(
    TRACK.map((point, index) => [point.row + '-' + point.col, index])
  );
  const laneLookup = new Map<string, Color>();
  COLORS.forEach(color =>
    HOME_LANES[color].forEach(point =>
      laneLookup.set(point.row + '-' + point.col, color)
    )
  );
  const cells = [];
  for (let row = 0; row < 15; row += 1) {
    for (let col = 0; col < 15; col += 1) {
      const key = row + '-' + col;
      const trackIndex = trackLookup.get(key);
      const laneColor = laneLookup.get(key);
      const baseColor: Color | null =
        row < 6 && col < 6
          ? 'red'
          : row < 6 && col > 8
            ? 'blue'
            : row > 8 && col > 8
              ? 'yellow'
              : row > 8 && col < 6
                ? 'green'
                : null;
      const isCenter = row >= 6 && row <= 8 && col >= 6 && col <= 8;
      const tokens = tokensAt.get(key) || [];
      const isStart = trackIndex !== undefined && SAFE_SQUARES.has(trackIndex);
      const classNames = [
        'board-cell',
        trackIndex !== undefined ? 'track-cell' : '',
        laneColor ? 'lane-cell lane-' + laneColor : '',
        baseColor ? 'base-cell base-' + baseColor : '',
        isCenter ? 'center-cell center-' + row + '-' + col : '',
        isStart ? 'safe-cell' : '',
      ]
        .filter(Boolean)
        .join(' ');
      cells.push(
        <div className={classNames} key={key}>
          {baseColor &&
          row === (baseColor === 'red' || baseColor === 'blue' ? 0 : 9) + 1 &&
          col === (baseColor === 'red' || baseColor === 'green' ? 0 : 9) + 1 ? (
            <span className="base-mark" />
          ) : null}
          {isStart ? <span className="safe-mark">✦</span> : null}
          {tokens.map(token => (
            <button
              key={token.player.id + '-' + token.index}
              type="button"
              aria-label={token.player.name + ' token ' + (token.index + 1)}
              disabled={!token.movable}
              className={
                'game-token token-' +
                token.player.color +
                (token.movable ? ' token-movable' : '')
              }
              onClick={() => onMove(token.index)}
            >
              {token.index + 1}
            </button>
          ))}
        </div>
      );
    }
  }
  return (
    <div className="board-shell">
      <div className="board-label-row">
        <span>THE BOARD</span>
        <span className="board-live">
          <i /> LIVE MATCH
        </span>
      </div>
      <div className="board-player-row">
        {room.players.map((player, index) => (
          <div className={'board-player-badge player-' + player.color + (room.status === 'playing' && room.state.currentTurnIndex === index ? ' is-turn' : '')} key={player.id}>
            <span>{player.name.slice(0, 1).toUpperCase()}</span>
            <b>{player.name}</b>
            <small>{player.isBot ? 'AI' : room.callParticipants?.includes(player.id) ? 'IN CALL' : 'READY'}</small>
          </div>
        ))}
      </div>
      <div className="ludo-board" aria-label="Ludo game board">
        {cells}
        <div className="board-center">
          <div className="center-diamond">
            <span className="diamond-red" />
            <span className="diamond-blue" />
            <span className="diamond-yellow" />
            <span className="diamond-green" />
          </div>
          <Trophy size={18} />
        </div>
      </div>
      <div className="board-footnote">
        <span>
          <i className="dot dot-safe" /> Safe square
        </span>
        <span>
          <i className="dot dot-home" /> Home lane
        </span>
        <span>
          {myTurn && dice !== null
            ? 'Tap a glowing token to move'
            : 'Waiting for the active player'}
        </span>
      </div>
    </div>
  );
}

function MediaTile({
  name,
  stream,
  local = false,
  video = false,
}: {
  name: string;
  stream: MediaStream;
  local?: boolean;
  video?: boolean;
}) {
  const mediaRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const element = mediaRef.current;
    if (element) {
      element.srcObject = stream;
      void element.play().catch(() => undefined);
    }
    return () => {
      if (element?.srcObject === stream) element.srcObject = null;
    };
  }, [stream]);

  return (
    <div className={'media-tile ' + (local ? 'media-local' : '')}>
      <video
        ref={mediaRef}
        autoPlay
        playsInline
        muted={local}
        className={video ? 'media-video' : 'media-audio-only'}
      />
      {!video ? (
        <span className="media-avatar">{name.slice(0, 1).toUpperCase()}</span>
      ) : null}
      <span className="media-name">
        {name}{local ? ' · You' : ''}
      </span>
    </div>
  );
}

export default function App() {
  const [authUser, setAuthUser] = useState<{ id: string; name: string; email: string; isGuest?: boolean } | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authMode, setAuthMode] = useState<'guest' | 'login'>('guest');
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authName, setAuthName] = useState('');
  const [authError, setAuthError] = useState('');
  const [authBusy, setAuthBusy] = useState(false);
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [upgradeEmail, setUpgradeEmail] = useState('');
  const [upgradePassword, setUpgradePassword] = useState('');
  const [upgradeError, setUpgradeError] = useState('');
  const [upgradeBusy, setUpgradeBusy] = useState(false);
  const playerId = authUser?.id || 'pending-authentication';
  const [name, setName] = useState(
    localStorage.getItem('ludo-live-player-name') || ''
  );
  const [roomCodeInput, setRoomCodeInput] = useState('');
  const [room, setRoom] = useState<Room | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [competitionOpen, setCompetitionOpen] = useState(false);
  const [activePage, setActivePage] = useState<'home' | 'play' | 'store'>('home');
  const [competitionTab, setCompetitionTab] = useState<'tournaments' | 'rankings' | 'profile' | 'watch' | 'replay' | 'friends' | 'season' | 'connect'>('tournaments');
  const [boardAppearance, setBoardAppearance] = useState<'classic' | 'premium'>('classic');
  const [callMinimized, setCallMinimized] = useState(false);
  const openCompetition = (tab: typeof competitionTab) => { setCompetitionTab(tab); setCompetitionOpen(true); };
  const [selectedGameMode, setSelectedGameMode] = useState<'classic' | 'one-v-one' | 'duo'>('classic');
  const [blockedPlayerIds, setBlockedPlayerIds] = useState<string[]>([]);
  const [searching, setSearching] = useState(false);
  const [queueId, setQueueId] = useState('');
  const [socketState, setSocketState] = useState<
    'connecting' | 'live' | 'offline'
  >('connecting');
  const [chatText, setChatText] = useState('');
  const [chatOpen, setChatOpen] = useState(false);
  const [crewOpen, setCrewOpen] = useState(false);
  const [hangoutOpen, setHangoutOpen] = useState(false);
  const [chatMode, setChatMode] = useState<'public' | 'private'>('public');
  const [chatRecipientId, setChatRecipientId] = useState('');
  const [privateMessages, setPrivateMessages] = useState<PrivateChatMessage[]>([]);
  const [copied, setCopied] = useState(false);
  const [callJoined, setCallJoined] = useState(false);
  const [callMode, setCallMode] = useState<'voice' | 'video' | null>(null);
  const [callBusy, setCallBusy] = useState(false);
  const [callMuted, setCallMuted] = useState(false);
  const [cameraEnabled, setCameraEnabled] = useState(false);
  const [callWindowPosition, setCallWindowPosition] = useState<{ x: number; y: number } | null>(null);
  const callDragOffsetRef = useRef({ x: 0, y: 0 });
  const [callError, setCallError] = useState('');
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStreams, setRemoteStreams] = useState<Record<string, MediaStream>>({});
  const localStreamRef = useRef<MediaStream | null>(null);
  const callJoinedRef = useRef(false);
  const signalHandlerRef = useRef<(data: any) => void>(() => undefined);
  const peerConnectionsRef = useRef(new Map<string, RTCPeerConnection>());
  const offeredPeersRef = useRef(new Set<string>());
  const pendingIceRef = useRef(new Map<string, RTCIceCandidateInit[]>());
  const pendingSignalsRef = useRef<any[]>([]);
  const connectionRef = useRef<ReturnType<typeof ws.connect> | null>(null);
  const roomCodeRef = useRef<string | null>(null);
  const botActionInFlightRef = useRef<string | null>(null);
  roomCodeRef.current = room?.code || null;

  useEffect(() => {
    const token = localStorage.getItem('ludo-live-auth-token');
    if (!token) { setAuthLoading(false); return; }
    api.get('/api/auth/me').then(response => {
      const user = response.data?.user;
      if (user?.id) {
        setAuthUser(user);
        setName(user.name || '');
        localStorage.setItem('ludo-live-player-name', user.name || '');
      } else setAuthToken(null);
    }).catch(() => setAuthToken(null)).finally(() => setAuthLoading(false));
  }, []);

  async function submitAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setAuthBusy(true); setAuthError('');
    try {
      const response = authMode === 'guest'
        ? await api.post('/api/auth/guest', { name: authName })
        : await api.post('/api/auth/login', { email: authEmail, password: authPassword });
      const user = response.data?.user, token = response.data?.token;
      if (!user?.id || !token) throw new Error('Your player identity could not be created.');
      setAuthToken(token); setAuthUser(user); setName(user.name || '');
      localStorage.setItem('ludo-live-player-name', user.name || '');
    } catch (error) { authErrorSet(error); }
    finally { setAuthBusy(false); }
  }

  function authErrorSet(error: unknown) {
    setAuthError(error instanceof TypeError ? 'Could not reach LUDO LIVE. Check your connection and try again.' : getErrorMessage(error));
  }

  async function linkPlayerEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setUpgradeBusy(true); setUpgradeError('');
    try {
      const response = await api.post('/api/auth/upgrade', { email: upgradeEmail, password: upgradePassword });
      const user = response.data?.user;
      if (!user?.id || user.id !== playerId || user.isGuest) throw new Error('Your email could not be linked to this player profile.');
      setAuthUser(user); setUpgradeOpen(false); setUpgradeEmail(''); setUpgradePassword('');
      setNotice('Email account linked. You can now host tournaments.');
    } catch (error) { setUpgradeError(error instanceof TypeError ? 'Could not reach LUDO LIVE. Check your connection and try again.' : getErrorMessage(error)); }
    finally { setUpgradeBusy(false); }
  }

  async function signOut() {
    if (callJoinedRef.current) {
      try { await leaveCall(); } catch { /* continue signing out */ }
    }
    if (room?.code) {
      try { await api.post('/api/rooms/' + room.code + '/leave', { playerId }); } catch { /* continue signing out */ }
    }
    try { await api.post('/api/auth/logout', {}); } catch { /* clear local session even if offline */ }
    setAuthToken(null); setAuthUser(null); setRoom(null);
    localStorage.removeItem('ludo-live-room-code');
  }

  const me = room?.players.find(player => player.id === playerId) || null;
  const currentPlayer = room?.players[room.state.currentTurnIndex] || null;
  const myTurn = currentPlayer?.id === playerId;
  const myTokens = room?.state.tokens[playerId] || [-1, -1, -1, -1];

  function getPlayerName() {
    const enteredName = name.trim();
    if (enteredName) return enteredName;
    const guestName = 'Guest ' + playerId.slice(-4).toUpperCase();
    setName(guestName);
    localStorage.setItem('ludo-live-player-name', guestName);
    return guestName;
  }

  const movableTokens =
    room === null || room.state.dice === null || !myTurn
      ? []
      : myTokens
          .map((position, index) =>
            canMove(position, room.state.dice as number) ? index : -1
          )
          .filter(index => index >= 0);

  useEffect(() => {
    const connection = ws.connect();
    connectionRef.current = connection;
    connection.onMessage((message: any) => {
      if (message?.type !== 'entity.update') return;
      const payload = message.payload;
      if (payload?.entity_type === 'private-chat') {
        if (payload?.entity_id !== roomCodeRef.current + '_' + playerId) return;
        const privateMessage = payload?.data?.message as PrivateChatMessage | undefined;
        if (privateMessage) {
          setPrivateMessages(current =>
            [...current.filter(item => item.id !== privateMessage.id), privateMessage].slice(-40)
          );
        }
        return;
      }
      if (payload?.entity_id !== roomCodeRef.current) return;
      if (payload?.entity_type === 'call-signal') {
        signalHandlerRef.current(payload?.data);
        return;
      }
      if (payload?.entity_type !== 'room') return;
      const updatedRoom = payload?.data?.room;
      if (updatedRoom) setRoom(updatedRoom as Room);
      else if (payload?.data?.closed) {
        setRoom(null);
        localStorage.removeItem('ludo-live-room-code');
        setNotice('This room has closed.');
      }
    });
    connection.onOpen(() => setSocketState('live'));
    connection.onClose(() => setSocketState('offline'));
    connection.onError(() => setSocketState('offline'));
    connection.ready
      .then(() => setSocketState('live'))
      .catch(() => setSocketState('offline'));
    return () => {
      connection.disconnect();
      connectionRef.current = null;
    };
  }, [authUser?.id, playerId]);

  useEffect(() => {
    api.get('/api/players/' + encodeURIComponent(playerId) + '/blocked')
      .then(response => setBlockedPlayerIds(response.data.blockedPlayerIds || []))
      .catch(() => undefined);
  }, [playerId]);

  useEffect(() => {
    if (!authUser?.id) return;
    const savedCode = localStorage.getItem('ludo-live-room-code');
    if (!savedCode) return;
    api
      .get('/api/rooms/' + savedCode)
      .then(response => setRoom(response.data.room as Room))
      .catch(() => localStorage.removeItem('ludo-live-room-code'));
  }, [authUser?.id]);

  useEffect(() => {
    if (!room?.code || socketState !== 'live') return;
    const connection = connectionRef.current;
    const connectionId = connection?.connectionId;
    if (!connection || !connectionId) return;
    let active = true;
    api
      .post('/api/subscriptions', {
        entity_type: 'room',
        entity_id: room.code,
        connection_id: connectionId,
      })
      .catch(() => {
        if (active) setSocketState('offline');
      });
    return () => {
      active = false;
      api
        .post('/api/subscriptions/remove', {
          entity_type: 'room',
          entity_id: room.code,
          connection_id: connectionId,
        })
        .catch(() => undefined);
    };
  }, [room?.code, socketState]);

  useEffect(() => {
    if (!room?.code || socketState !== 'live') return;
    const connection = connectionRef.current;
    const connectionId = connection?.connectionId;
    if (!connection || !connectionId) return;
    let active = true;
    api
      .post('/api/subscriptions', {
        entity_type: 'call-signal',
        entity_id: room.code,
        connection_id: connectionId,
      })
      .catch(() => {
        if (active) setCallError('Live call signaling is unavailable right now.');
      });
    return () => {
      active = false;
      api
        .post('/api/subscriptions/remove', {
          entity_type: 'call-signal',
          entity_id: room.code,
          connection_id: connectionId,
        })
        .catch(() => undefined);
    };
  }, [room?.code, socketState]);

  useEffect(() => {
    if (!room?.code || socketState !== 'live') return;
    const connection = connectionRef.current;
    const connectionId = connection?.connectionId;
    if (!connection || !connectionId) return;
    let active = true;
    api.post('/api/subscriptions', {
      entity_type: 'private-chat',
      entity_id: room.code + '_' + playerId,
      connection_id: connectionId,
    }).catch(() => {
      if (active) setNotice('Private chat notifications are reconnecting.');
    });
    return () => {
      active = false;
      api.post('/api/subscriptions/remove', {
        entity_type: 'private-chat',
        entity_id: room.code + '_' + playerId,
        connection_id: connectionId,
      }).catch(() => undefined);
    };
  }, [room?.code, socketState, playerId]);

  useEffect(() => {
    signalHandlerRef.current = data => {
      void handleIncomingSignal(data);
    };
  }, [callJoined, room?.code, playerId]);

  useEffect(() => {
    if (!callJoined || !room?.code) return;
    const activePeers = (room.callParticipants || []).filter(id => id !== playerId);
    activePeers.forEach(remoteId => {
      if (playerId.localeCompare(remoteId) < 0) {
        void createOfferForPeer(remoteId);
      }
    });
    peerConnectionsRef.current.forEach((connection, remoteId) => {
      if (!activePeers.includes(remoteId)) {
        connection.close();
        peerConnectionsRef.current.delete(remoteId);
        offeredPeersRef.current.delete(remoteId);
      }
    });
    setRemoteStreams(current => {
      const next = { ...current };
      let changed = false;
      Object.keys(next).forEach(id => {
        if (!activePeers.includes(id)) {
          delete next[id];
          changed = true;
        }
      });
      return changed ? next : current;
    });
  }, [callJoined, room?.code, (room?.callParticipants || []).join('|')]);

  useEffect(() => {
    if (name) localStorage.setItem('ludo-live-player-name', name);
  }, [name]);

  useEffect(() => {
    if (!room) return;
    const availablePeers = room.players.filter(player => player.id !== playerId && !player.isBot);
    if (!availablePeers.some(player => player.id === chatRecipientId)) {
      setChatRecipientId(availablePeers[0]?.id || '');
    }
  }, [room?.code, room?.players.length, chatRecipientId, playerId]);

  useEffect(() => {
    if (!room?.code || !chatOpen || chatMode !== 'private' || !chatRecipientId) return;
    let active = true;
    api.post('/api/rooms/' + room.code + '/private-chat/list', {
      playerId,
      peerId: chatRecipientId,
    }).then(response => {
      if (active) setPrivateMessages((response.data?.messages || []) as PrivateChatMessage[]);
    }).catch(error => {
      if (active) setNotice(getErrorMessage(error));
    });
    return () => {
      active = false;
    };
  }, [room?.code, chatOpen, chatMode, chatRecipientId, playerId]);

  useEffect(() => {
    if (!searching || !queueId) return;
    let active = true;
    const pollMatch = async () => {
      try {
        const response = await api.post('/api/matchmaking/status', {
          queueId,
          playerId,
        });
        if (!active) return;
        if (response.data?.room) {
          const nextRoom = response.data.room as Room;
          setRoom(nextRoom);
          localStorage.setItem('ludo-live-room-code', nextRoom.code);
          setSearching(false);
          setQueueId('');
          setNotice('Match found! Good luck.');
        } else if (response.data?.status === 'expired') {
          setSearching(false);
          setQueueId('');
          setNotice('The search timed out. Try again when you are ready.');
        } else if (response.data?.status === 'cancelled') {
          setSearching(false);
          setQueueId('');
        }
      } catch (error) {
        if (active) setNotice(getErrorMessage(error));
      }
    };
    const interval = window.setInterval(() => void pollMatch(), 2500);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [searching, queueId, playerId]);

  useEffect(() => {
    const botPlayer = room?.players[room.state.currentTurnIndex];
    if (
      !room ||
      room.status !== 'playing' ||
      !botPlayer?.isBot ||
      room.state.dice !== null
    ) return;

    const expectedActionVersion = room.state.botActionVersion || 0;
    const actionKey = room.code + ':' + botPlayer.id + ':' + expectedActionVersion;
    if (botActionInFlightRef.current === actionKey) return;

    let active = true;
    const timeout = window.setTimeout(async () => {
      if (!active) return;
      botActionInFlightRef.current = actionKey;
      try {
        const response = await api.post('/api/rooms/' + room.code + '/bot/turn', {
          expectedActionVersion,
        });
        if (active && response.data?.room) {
          setRoom(response.data.room as Room);
        }
      } catch (error) {
        if (active) {
          try {
            const latest = await api.get('/api/rooms/' + room.code);
            if (active && latest.data?.room) {
              setRoom(latest.data.room as Room);
            } else if (active) {
              setNotice(getErrorMessage(error));
            }
          } catch {
            if (active) setNotice(getErrorMessage(error));
          }
        }
      } finally {
        if (botActionInFlightRef.current === actionKey) {
          botActionInFlightRef.current = null;
        }
      }
    }, 650);

    return () => {
      active = false;
      window.clearTimeout(timeout);
    };
  }, [room?.code, room?.status, currentPlayer?.id, room?.state.dice, room?.state.botActionVersion]);

  async function runAction(path: string, body: Record<string, unknown>) {
    setBusy(true);
    setNotice('');
    try {
      const response = await api.post(path, { ...body, playerId });
      if (response.data?.room) setRoom(response.data.room as Room);
      if (response.data?.closed) {
        setRoom(null);
        localStorage.removeItem('ludo-live-room-code');
      }
      return response.data;
    } catch (error) {
      setNotice(getErrorMessage(error));
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function createRoom() {
    const playerName = getPlayerName();
    setBusy(true);
    setNotice('');
    try {
      const response = await api.post('/api/rooms', {
        name: playerName,
        playerId,
        gameMode: selectedGameMode,
      });
      const nextRoom = response.data?.room as Room | undefined;
      if (!nextRoom?.code || !nextRoom.players?.length) {
        throw new Error('The room was not returned. Please try creating it again.');
      }
      setRoom(nextRoom);
      localStorage.setItem('ludo-live-room-code', nextRoom.code);
      setNotice('Room ' + nextRoom.code + ' is ready. Copy the invite code to bring your friends in.');
    } catch (error) {
      setNotice(getErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function createComputerGame() {
    const playerName = getPlayerName();
    setBusy(true);
    setNotice('');
    try {
      const response = await api.post('/api/rooms/computer', {
        name: playerName,
        playerId,
        botCount: 3,
      });
      const nextRoom = response.data?.room as Room | undefined;
      if (!nextRoom?.code || !nextRoom.players?.some(player => player.id === playerId)) {
        throw new Error('The computer match was not returned. Please try again.');
      }
      setRoom(nextRoom);
      localStorage.setItem('ludo-live-room-code', nextRoom.code);
      setNotice('Computer match ready. Roll the dice to begin!');
    } catch (error) {
      setNotice(getErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function findRandomMatch() {
    const playerName = getPlayerName();
    setBusy(true);
    setNotice('');
    const nextQueueId = 'Q' + Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
    try {
      const response = await api.post('/api/matchmaking/join', {
        name: playerName,
        playerId,
        queueId: nextQueueId,
      });
      if (response.data?.room) {
        const nextRoom = response.data.room as Room;
        setRoom(nextRoom);
        localStorage.setItem('ludo-live-room-code', nextRoom.code);
      } else {
        setQueueId(nextQueueId);
        setSearching(true);
      }
    } catch (error) {
      setNotice(getErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function cancelMatchmaking() {
    if (!queueId) return;
    try {
      await api.post('/api/matchmaking/cancel', { queueId, playerId });
    } catch (error) {
      setNotice(getErrorMessage(error));
    } finally {
      setSearching(false);
      setQueueId('');
    }
  }

  async function joinRoom() {
    const playerName = getPlayerName();
    const code = roomCodeInput
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .slice(0, 6);
    if (code.length !== 6) {
      setNotice('Enter the 6-character room code.');
      return;
    }
    const data = await runAction('/api/rooms/' + code + '/join', {
      name: playerName,
    });
    if (data?.room) localStorage.setItem('ludo-live-room-code', code);
  }

  async function leaveRoom() {
    if (!room) return;
    if (callJoinedRef.current) await leaveCall();
    await runAction('/api/rooms/' + room.code + '/leave', {});
    setRoom(null);
    localStorage.removeItem('ludo-live-room-code');
    setNotice('You left the room. Create or join another match!');
  }

  async function reportPlayer(targetPlayerId: string) {
    if (!room || !targetPlayerId) return;
    const reason = window.prompt('Report reason: harassment, spam, cheating, inappropriate-name, or other');
    if (!reason) return;
    const normalized = reason.trim().toLowerCase().replace(/\\s+/g, '-');
    try {
      await api.post('/api/safety/report', { reporterId: playerId, targetPlayerId, roomCode: room.code, reason: normalized });
      setNotice('Report submitted. Thank you for helping keep Ludo Live safe.');
    } catch (error) { setNotice(getErrorMessage(error)); }
  }

  async function blockPlayer(targetPlayerId: string) {
    if (!targetPlayerId || !window.confirm('Block this player? This prevents new friend requests, private messages, room joins and matchmaking between you.')) return;
    try {
      await api.post('/api/safety/block', { blockerId: playerId, blockedId: targetPlayerId });
      setBlockedPlayerIds(current => [...new Set([...current, targetPlayerId])]);
      setNotice('Player blocked. Room joins, private messages, friend requests and matchmaking are now restricted.');
    } catch (error) { setNotice(getErrorMessage(error)); }
  }

  async function sendChat(text: string, kind: 'chat' | 'reaction' = 'chat') {
    if (!room) return;
    if (chatMode === 'private' && kind === 'chat') {
      if (!chatRecipientId) {
        setNotice('Choose a player for your private message.');
        return;
      }
      const data = await runAction('/api/rooms/' + room.code + '/private-chat', {
        toPlayerId: chatRecipientId,
        text,
      });
      if (data?.message) {
        const message = data.message as PrivateChatMessage;
        setPrivateMessages(current =>
          [...current.filter(item => item.id !== message.id), message].slice(-40)
        );
        setChatText('');
      }
      return;
    }
    const data = await runAction('/api/rooms/' + room.code + '/chat', {
      text,
      kind,
    });
    if (data && kind === 'chat') setChatText('');
  }

  async function sendPeerSignal(
    toPlayerId: string,
    signal: Record<string, unknown>
  ) {
    const code = roomCodeRef.current;
    if (!code || !callJoinedRef.current) return;
    await api.post('/api/rooms/' + code + '/signal', {
      playerId,
      toPlayerId,
      signal,
    });
  }

  function getPeerConnection(remoteId: string): RTCPeerConnection {
    const existing = peerConnectionsRef.current.get(remoteId);
    if (existing) return existing;

    const connection = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
      ],
    });
    const stream = localStreamRef.current;
    if (stream) {
      stream.getTracks().forEach(track => connection.addTrack(track, stream));
    }
    connection.onicecandidate = event => {
      if (!event.candidate) return;
      void sendPeerSignal(remoteId, {
        type: 'ice',
        candidate: event.candidate.toJSON(),
      }).catch(error => setCallError(getErrorMessage(error)));
    };
    connection.ontrack = event => {
      const remoteStream = event.streams[0] || new MediaStream([event.track]);
      setRemoteStreams(current => ({ ...current, [remoteId]: remoteStream }));
    };
    connection.onconnectionstatechange = () => {
      if (connection.connectionState === 'failed') {
        setCallError('A direct connection could not be made. Try another network.');
      }
    };
    peerConnectionsRef.current.set(remoteId, connection);
    return connection;
  }

  async function drainPendingIce(
    remoteId: string,
    connection: RTCPeerConnection
  ) {
    const queued = pendingIceRef.current.get(remoteId) || [];
    pendingIceRef.current.delete(remoteId);
    for (const candidate of queued) {
      await connection.addIceCandidate(new RTCIceCandidate(candidate));
    }
  }

  async function handleIncomingSignal(data: any) {
    if (
      !data ||
      data.toPlayerId !== playerId ||
      !data.fromPlayerId ||
      data.fromPlayerId === playerId ||
      !data.signal
    ) return;
    if (!callJoinedRef.current) {
      pendingSignalsRef.current.push(data);
      return;
    }

    const remoteId = String(data.fromPlayerId);
    const signal = data.signal;
    const connection = getPeerConnection(remoteId);
    try {
      if (signal.type === 'ice' && signal.candidate) {
        const candidate = signal.candidate as RTCIceCandidateInit;
        if (connection.remoteDescription) {
          await connection.addIceCandidate(new RTCIceCandidate(candidate));
        } else {
          const queued = pendingIceRef.current.get(remoteId) || [];
          queued.push(candidate);
          pendingIceRef.current.set(remoteId, queued);
        }
        return;
      }

      if (signal.type === 'offer' && signal.sdp) {
        await connection.setRemoteDescription(
          new RTCSessionDescription(signal.sdp as RTCSessionDescriptionInit)
        );
        await drainPendingIce(remoteId, connection);
        const answer = await connection.createAnswer();
        await connection.setLocalDescription(answer);
        await sendPeerSignal(remoteId, {
          type: 'answer',
          sdp: connection.localDescription?.toJSON() || connection.localDescription,
        });
        return;
      }

      if (signal.type === 'answer' && signal.sdp) {
        await connection.setRemoteDescription(
          new RTCSessionDescription(signal.sdp as RTCSessionDescriptionInit)
        );
        await drainPendingIce(remoteId, connection);
      }
    } catch (error) {
      setCallError(getErrorMessage(error));
    }
  }

  async function createOfferForPeer(remoteId: string) {
    if (
      !callJoinedRef.current ||
      offeredPeersRef.current.has(remoteId)
    ) return;
    const connection = getPeerConnection(remoteId);
    if (connection.signalingState !== 'stable') return;
    offeredPeersRef.current.add(remoteId);
    try {
      const offer = await connection.createOffer();
      await connection.setLocalDescription(offer);
      await sendPeerSignal(remoteId, {
        type: 'offer',
        sdp: connection.localDescription?.toJSON() || connection.localDescription,
      });
    } catch (error) {
      offeredPeersRef.current.delete(remoteId);
      setCallError(getErrorMessage(error));
    }
  }

  async function joinCall(mode: 'voice' | 'video') {
    if (!room) return;
    setCallBusy(true);
    setCallError('');
    let stream: MediaStream | null = null;
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('This browser does not support microphone or camera access.');
      }
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
        video: mode === 'video' ? { facingMode: 'user' } : false,
      });
      localStreamRef.current = stream;
      setLocalStream(stream);
      setCallMode(mode);
      setCallMuted(false);
      setCameraEnabled(mode === 'video');

      const response = await api.post('/api/rooms/' + room.code + '/call/join', {
        playerId,
      });
      setRoom(response.data.room as Room);
      callJoinedRef.current = true;
      setCallJoined(true);
      const queued = pendingSignalsRef.current.splice(0);
      queued.forEach(signal => void handleIncomingSignal(signal));
    } catch (error) {
      stream?.getTracks().forEach(track => track.stop());
      localStreamRef.current = null;
      setLocalStream(null);
      setCallMode(null);
      setCameraEnabled(false);
      setCallError(getErrorMessage(error));
    } finally {
      setCallBusy(false);
    }
  }

  async function leaveCall() {
    const code = roomCodeRef.current;
    callJoinedRef.current = false;
    setCallJoined(false);
    peerConnectionsRef.current.forEach(connection => connection.close());
    peerConnectionsRef.current.clear();
    offeredPeersRef.current.clear();
    pendingIceRef.current.clear();
    pendingSignalsRef.current = [];
    localStreamRef.current?.getTracks().forEach(track => track.stop());
    localStreamRef.current = null;
    setLocalStream(null);
    setRemoteStreams({});
    setCallMode(null);
    setCallMuted(false);
    setCameraEnabled(false);
    if (code) {
      try {
        const response = await api.post('/api/rooms/' + code + '/call/leave', {
          playerId,
        });
        if (response.data?.room) setRoom(response.data.room as Room);
      } catch (error) {
        setCallError(getErrorMessage(error));
      }
    }
  }

  function toggleMute() {
    const nextMuted = !callMuted;
    localStreamRef.current?.getAudioTracks().forEach(track => {
      track.enabled = !nextMuted;
    });
    setCallMuted(nextMuted);
  }

  function toggleCamera() {
    const nextEnabled = !cameraEnabled;
    localStreamRef.current?.getVideoTracks().forEach(track => {
      track.enabled = nextEnabled;
    });
    setCameraEnabled(nextEnabled);
  }

  async function switchToVideo() {
    await leaveCall();
    await joinCall('video');
  }

  async function copyCode() {
    if (!room) return;
    try {
      await navigator.clipboard.writeText(room.code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setNotice(
        'Room code: ' + room.code + ' — copy it to invite your friends.'
      );
    }
  }

  const requiredPlayers = room?.gameMode === 'one-v-one' ? 2 : room?.gameMode === 'duo' ? 4 : 2;
  const canStart = Boolean(
    room && me?.host && room.status === 'waiting' &&
    (room.gameMode === 'classic' || !room.gameMode ? room.players.length >= 2 : room.players.length === requiredPlayers)
  );
  const noMoves = Boolean(
    room && myTurn && room.state.dice !== null && movableTokens.length === 0
  );
  const winner = room?.players.find(player => player.id === room.state.winner);
  const callPlayers =
    room?.players.filter(player =>
      (room.callParticipants || []).includes(player.id)
    ) || [];
  const visibleMessages: ChatMessage[] =
    chatMode === 'public'
      ? (room?.messages || []).filter(message => !blockedPlayerIds.includes(message.playerId))
      : privateMessages.filter(message => !blockedPlayerIds.includes(message.playerId) && (
          (message.playerId === playerId && message.recipientId === chatRecipientId) ||
          (message.playerId === chatRecipientId && message.recipientId === playerId)
        ));

  if (authLoading) return <main className="auth-screen"><div className="auth-card"><div className="auth-brand">LUDO <b>LIVE</b></div><p>Checking your player session…</p></div></main>;
  if (!authUser) {
    return (
      <main className="auth-screen">
        <form className="auth-card" onSubmit={submitAuth}>
          <div className="auth-brand">LUDO <b>LIVE</b></div>
          <span className="auth-kicker">YOUR PLAYER IDENTITY</span>
          {authMode === 'guest' ? <>
            <h1>Enter the game</h1>
            <p>Choose your player name and jump straight into LUDO LIVE. No email or password needed.</p>
            <label>Player name<input required minLength={2} maxLength={18} value={authName} onChange={event => setAuthName(event.target.value)} placeholder="Your player name" autoComplete="nickname" /></label>
          </> : <>
            <h1>Welcome back</h1>
            <p>Sign in to an existing email-linked player account.</p>
            <label>Email address<input required type="email" autoComplete="email" value={authEmail} onChange={event => setAuthEmail(event.target.value)} placeholder="you@example.com" /></label>
            <label>Password<input required type="password" autoComplete="current-password" value={authPassword} onChange={event => setAuthPassword(event.target.value)} placeholder="Your password" /></label>
          </>}
          {authError ? <div className="auth-error" role="alert">{authError}</div> : null}
          <button className="auth-submit" type="submit" disabled={authBusy}>{authBusy ? 'Please wait…' : authMode === 'guest' ? 'PLAY NOW' : 'SIGN IN'}</button>
          <button className="auth-switch" type="button" onClick={() => { setAuthMode(authMode === 'guest' ? 'login' : 'guest'); setAuthError(''); }}>{authMode === 'guest' ? 'Already have an account? Sign in' : 'Continue with player name instead'}</button>
          <small className="auth-privacy">You can add an email later to host tournaments and keep your player profile recoverable.</small>
        </form>
      </main>
    );
  }

  if (!room || !me) {
    return (
      <main id="home" className="app-root landing-root">
        <div className="ambient ambient-one" />
        <div className="ambient ambient-two" />
        <header className="topbar">
          <a className="brand" href="#home">
            <span className="brand-mark">
              <Dice5 size={22} />
            </span>
            <span>
              LUDO<span className="brand-accent">LIVE</span>
            </span>
          </a>
          <nav className="primary-nav" aria-label="Main navigation">
            <button className={activePage === 'home' && !competitionOpen ? 'nav-current' : ''} onClick={() => { setCompetitionOpen(false); setActivePage('home'); }}>Home</button>
            <button className={activePage === 'play' && !competitionOpen ? 'nav-current' : ''} onClick={() => { setCompetitionOpen(false); setActivePage('play'); }}>Play</button>
            <button className={competitionOpen && competitionTab === 'tournaments' ? 'nav-current' : ''} onClick={() => openCompetition('tournaments')}>Tournaments</button>
            <button className={activePage === 'store' && !competitionOpen ? 'nav-current' : ''} onClick={() => { setCompetitionOpen(false); setActivePage('store'); }}>Store</button>
            <button onClick={() => openCompetition('friends')}>Friends</button>
            <button onClick={() => openCompetition('profile')}>Profile</button>
          </nav>
          <div className="topbar-right">
            <button className="secondary-button" onClick={() => openCompetition('tournaments')}><Trophy size={15}/> COMPETE</button>
            <span className="online-pill">
              <i /> MULTIPLAYER ONLINE
            </span>
            <span className="account-chip">{authUser.name}</span>
            {authUser.isGuest ? <button className="account-signout" onClick={() => { setUpgradeOpen(true); setUpgradeError(""); }}>ADD EMAIL</button> : null}
            <button className="account-signout" onClick={() => void signOut()}>SIGN OUT</button>
          </div>
        </header>
        {competitionOpen ? <CompetitionHub playerId={playerId} playerName={getPlayerName()} isGuest={!!authUser.isGuest} onUpgrade={() => { setCompetitionOpen(false); setUpgradeOpen(true); }} initialTab={competitionTab} onClose={() => setCompetitionOpen(false)} /> : null}
        {upgradeOpen ? <div className="auth-screen" role="dialog" aria-modal="true" aria-label="Add email to player profile"><form className="auth-card" onSubmit={linkPlayerEmail}><div className="auth-brand">LUDO <b>LIVE</b></div><span className="auth-kicker">UPGRADE PLAYER PROFILE</span><h1>Keep your player identity</h1><p>Add an email and password to recover this same player profile on another device and unlock tournament hosting. Your player ID and match history stay the same.</p><label>Email address<input required type="email" autoComplete="email" value={upgradeEmail} onChange={event => setUpgradeEmail(event.target.value)} placeholder="you@example.com" /></label><label>Create password<input required type="password" minLength={10} autoComplete="new-password" value={upgradePassword} onChange={event => setUpgradePassword(event.target.value)} placeholder="At least 10 characters" /></label><small>Use at least 10 characters, including letters and numbers.</small>{upgradeError ? <div className="auth-error" role="alert">{upgradeError}</div> : null}<button className="auth-submit" type="submit" disabled={upgradeBusy}>{upgradeBusy ? "Saving…" : "LINK EMAIL & UNLOCK"}</button><button className="auth-switch" type="button" onClick={() => setUpgradeOpen(false)}>Not now</button></form></div> : null}
        {!competitionOpen && activePage === 'home' ? <section className="home-dashboard">
          <div className="home-welcome"><div><span className="mini-label">WELCOME BACK · LUDO LIVE</span><h1>Ready for your next <em>great game?</em></h1><p>Your table is waiting. Challenge friends, climb the rankings and collect your favourite looks.</p><div className="home-actions"><button className="primary-button" onClick={() => setActivePage('play')}><Gamepad2 size={17}/> Play now</button><button className="secondary-button" onClick={() => setActivePage('store')}><ShoppingBag size={16}/> Visit store</button></div></div><div className="home-hero-art"><div className="home-orbit"><span className="orbit-token orbit-red"/><span className="orbit-token orbit-blue"/><span className="orbit-token orbit-yellow"/><span className="orbit-token orbit-green"/><Dice5 size={78}/></div><span className="home-art-caption">ROLL · PLAY · REPEAT</span></div></div>
          <div className="home-section-heading"><div><span className="mini-label">YOUR LUDO UNIVERSE</span><h2>Make today a game day</h2></div><span className="online-pill"><i/> MULTIPLAYER ONLINE</span></div>
          <div className="home-feature-grid">
            <button className="home-feature-card home-feature-play" onClick={() => setActivePage('play')}><Gamepad2 size={27}/><b>Choose your game</b><small>Play computer, friends or online opponents.</small><span>EXPLORE PLAY <ArrowRight size={14}/></span></button>
            <button className="home-feature-card home-feature-arena" onClick={() => openCompetition('tournaments')}><Trophy size={27}/><b>Enter the arena</b><small>Compete in free community tournaments.</small><span>VIEW CHAMPIONSHIPS <ArrowRight size={14}/></span></button>
            <button className="home-feature-card home-feature-store" onClick={() => setActivePage('store')}><ShoppingBag size={27}/><b>Personalise your game</b><small>Discover dice, trails, tokens and board styles.</small><span>EXPLORE STORE <ArrowRight size={14}/></span></button>
          </div>
          <div className="home-bottom-grid"><div className="home-info-card"><span className="mini-label">FAIR PLAY FIRST</span><h3>Every player gets a fair shot.</h3><p>Cosmetics change your style, never your chances of winning. Play free, earn coins and build your collection.</p></div><div className="home-info-card"><span className="mini-label">COMMUNITY</span><h3>Your next move starts here.</h3><p>Invite your crew, watch matches and celebrate great games together.</p><button className="text-link-button" onClick={() => openCompetition('friends')}>Find your friends <ArrowRight size={14}/></button></div></div>
        </section> : null}
        {!competitionOpen && activePage === 'play' ? <section className="hero">
          <div className="hero-copy">
            <div className="eyebrow">
              <Sparkles size={14} /> YOUR CREW. YOUR GAME.
            </div>
            <h1>
              Roll the dice.
              <br />
              <span>Bring everyone</span>
              <br />
              to the table.
            </h1>
            <p className="hero-description">
              A classic Ludo night, now live. Create a room, invite your people
              and play together from anywhere.
            </p>
            <div className="hero-points">
              <span>
                <Wifi size={15} /> Live turns
              </span>
              <span>
                <MessageCircle size={15} /> In-game chat
              </span>
              <span>
                <Users size={15} /> 2–4 players
              </span>
            </div>
          </div>
          <div id="play" className="join-card">
            <div className="card-orbit">
              <div className="orbit-token orbit-red" />
              <div className="orbit-token orbit-blue" />
              <div className="orbit-token orbit-yellow" />
              <div className="orbit-token orbit-green" />
              <Dice5 size={42} />
            </div>
            <div className="join-card-heading">
              <span className="mini-label">PLAYER SETUP</span>
              <h2>Ready to play?</h2>
              <p>Choose a name or continue as a guest, then jump into a room.</p>
            </div>
            <label className="field-label" htmlFor="player-name">
              YOUR PLAYER NAME
            </label>
            <input
              id="player-name"
              className="text-field"
              maxLength={18}
              value={name}
              onChange={event => setName(event.target.value)}
              placeholder="e.g. Dice Master"
            />
            <div className="game-mode-picker" aria-label="Choose game rules">
              <span className="field-label">GAME MODE</span>
              <div className="game-mode-options">
                <button type="button" className={selectedGameMode === 'classic' ? 'game-mode-option selected' : 'game-mode-option'} onClick={() => setSelectedGameMode('classic')}><b>Classic</b><small>2–4 players · everyone for themselves</small></button>
                <button type="button" className={selectedGameMode === 'one-v-one' ? 'game-mode-option selected' : 'game-mode-option'} onClick={() => setSelectedGameMode('one-v-one')}><b>1v1 Duel</b><small>Exactly 2 players · dedicated duel</small></button>
                <button type="button" className={selectedGameMode === 'duo' ? 'game-mode-option selected' : 'game-mode-option'} onClick={() => setSelectedGameMode('duo')}><b>2v2 Teams</b><small>4 players · both teammates must finish all tokens</small></button>
              </div>
            </div>
            <div className="play-mode-grid">
              <button
                className="mode-card mode-friends"
                disabled={busy || searching}
                onClick={createRoom}
              >
                <span className="mode-icon"><Users size={19} /></span>
                <span><b>Play with friends</b><small>Create a private room and share its code</small></span>
                <ArrowRight size={17} />
              </button>
              <button
                className="mode-card mode-computer"
                disabled={busy || searching}
                onClick={createComputerGame}
              >
                <span className="mode-icon"><Bot size={19} /></span>
                <span><b>Play with computer</b><small>You vs 3 smart computer opponents</small></span>
                <ArrowRight size={17} />
              </button>
              <button
                className="mode-card mode-random"
                disabled={busy || searching}
                onClick={findRandomMatch}
              >
                <span className="mode-icon"><Shuffle size={19} /></span>
                <span><b>Quick 1v1 match</b><small>Find another player online</small></span>
                <ArrowRight size={17} />
              </button>
            </div>
            {searching ? (
              <div className="matchmaking-search">
                <div className="matchmaking-copy">
                  <span className="search-pulse" />
                  <b>Finding players...</b>
                  <small>Keep this screen open. We'll join you when someone is ready.</small>
                </div>
                <button className="secondary-button" onClick={cancelMatchmaking}>Cancel</button>
              </div>
            ) : null}
            <div className="separator">
              <span /> OR JOIN WITH A ROOM CODE <span />
            </div>
            <label className="field-label" htmlFor="room-code">
              ROOM INVITE CODE
            </label>
            <div className="join-code-row">
              <input
                id="room-code"
                className="text-field code-input"
                maxLength={6}
                value={roomCodeInput}
                onChange={event =>
                  setRoomCodeInput(
                    event.target.value
                      .toUpperCase()
                      .replace(/[^A-Z0-9]/g, '')
                      .slice(0, 6)
                  )
                }
                placeholder="ABC123"
              />
              <button
                className="secondary-button"
                disabled={busy || roomCodeInput.length !== 6}
                onClick={joinRoom}
              >
                Join <ChevronRight size={17} />
              </button>
            </div>
            <div className="guest-note">
              <Shield size={14} /> No account needed. Leave your name blank to play as a guest.
            </div>
            {notice ? (
              <div className="notice">
                <X size={15} /> {notice}
              </div>
            ) : null}
          </div>
        </section> : null}
        {!competitionOpen && activePage === 'play' ? <section className="feature-strip">
          <div>
            <span className="feature-icon feature-purple">
              <Wifi size={19} />
            </span>
            <span>
              <b>Live together</b>
              <small>Every move syncs instantly</small>
            </span>
          </div>
          <div>
            <span className="feature-icon feature-orange">
              <Users size={19} />
            </span>
            <span>
              <b>Private rooms</b>
              <small>Invite 2–4 players by code</small>
            </span>
          </div>
          <div>
            <span className="feature-icon feature-green">
              <MessageCircle size={19} />
            </span>
            <span>
              <b>Talk your talk</b>
              <small>Chat and react while playing</small>
            </span>
          </div>
        </section> : null}
        {!competitionOpen && activePage === 'store' ? <Store playerId={playerId} onBack={() => setActivePage('home')} /> : null}
        <footer className="landing-footer">
          LUDO LIVE <span>•</span> FRIENDS MAKE THE GAME
        </footer>
      </main>
    );
  }



  return (
    <main className="app-root game-root">
      <header className="game-topbar">
        <button
          className={'hud-chat-toggle ' + (chatOpen ? 'active' : '')}
          onClick={() => {
            setCrewOpen(false);
            setHangoutOpen(false);
            setChatOpen(open => !open);
          }}
          aria-label={chatOpen ? 'Close game chat' : 'Open game chat'}
          aria-expanded={chatOpen}
        >
          <MessageCircle size={17} />
          <span>CHAT</span>
          {room.messages.length > 0 ? <i /> : null}
        </button>
        <button
          className={'hud-panel-toggle ' + (crewOpen ? 'active' : '')}
          onClick={() => {
            setChatOpen(false);
            setHangoutOpen(false);
            setCrewOpen(open => !open);
          }}
          aria-label={crewOpen ? 'Close The Crew' : 'Open The Crew'}
          aria-expanded={crewOpen}
        >
          <Users size={16} /> <span>THE CREW</span>
          <small>{room.players.length}/{room.gameMode === 'one-v-one' ? 2 : 4}</small>
        </button>
        <button
          className={'hud-panel-toggle ' + (hangoutOpen ? 'active' : '')}
          onClick={() => {
            setChatOpen(false);
            setCrewOpen(false);
            setHangoutOpen(open => !open);
          }}
          aria-label={hangoutOpen ? 'Close Live Hangout' : 'Open Live Hangout'}
          aria-expanded={hangoutOpen}
        >
          <Phone size={16} /> <span>HANGOUT</span>
          {callPlayers.length > 0 ? <small>{callPlayers.length}</small> : null}
        </button>
        <a
          className="brand"
          href="#home"
          onClick={event => {
            event.preventDefault();
            leaveRoom();
          }}
        >
          <span className="brand-mark">
            <Dice5 size={21} />
          </span>
          <span>
            LUDO<span className="brand-accent">LIVE</span>
          </span>
        </a>
        <button className="board-style-toggle" onClick={() => setBoardAppearance(value => value === 'classic' ? 'premium' : 'classic')} title="Switch board appearance"><Dice5 size={15}/><span>{boardAppearance === 'classic' ? 'Classic board' : 'Premium board'}</span></button>
        <div className="room-chip">
          <span>ROOM</span>
          <b>{room.code}</b>
          <button onClick={copyCode} aria-label="Copy room code">
            {copied ? <Check size={15} /> : <Copy size={15} />}
          </button>
        </div>
        <div className="game-top-actions">
          <span className={'connection-status ' + socketState}>
            {socketState === 'live' ? (
              <Wifi size={14} />
            ) : (
              <WifiOff size={14} />
            )}
            {socketState === 'live' ? 'LIVE' : 'RECONNECTING'}
          </span>
          <button className="leave-button" onClick={leaveRoom}>
            <DoorOpen size={16} />
            <span>Leave</span>
          </button>
        </div>
      </header>
      <div className={'game-layout board-theme-' + boardAppearance + ' ' + (chatOpen ? 'chat-expanded panel-chat-open' : '') + (crewOpen ? ' panel-crew-open' : '') + (hangoutOpen ? ' panel-hangout-open' : '')}>
        <div className="landscape-hint">Rotate your phone for the full-screen landscape game.</div>
        <section className="play-column">
          <div className="match-heading">
            <div>
              <div className="eyebrow">
                <span className="eyebrow-dot" />{' '}
                {room.status === 'finished'
                  ? 'MATCH COMPLETE'
                  : room.mode === 'computer'
                    ? 'AI CHALLENGE'
                    : room.mode === 'random'
                      ? 'QUICK MATCH'
                      : room.status === 'waiting'
                        ? 'ROOM LOBBY'
                        : 'LIVE MATCH'}
              </div>
              <h1>
                {room.status === 'waiting'
                  ? 'Waiting for your crew'
                  : room.status === 'finished'
                    ? 'We have a winner!'
                    : 'Let the race begin.'}
              </h1>
              <p>{room.state.turnMessage}</p>
            </div>
            {room.status === 'waiting' ? (
              <div className="waiting-badge">
                <Users size={16} /> {room.players.length}/{room.gameMode === 'one-v-one' ? 2 : 4} players
              </div>
            ) : null}
            {room.status === 'finished' && winner ? (
              <div className="winner-badge">
                <Trophy size={16} /> {room.state.winnerTeam ? 'Team ' + (room.state.winnerTeam === 'sun' ? 'Sun' : 'Moon') + ' won' : winner.name + ' won'}
              </div>
            ) : null}
          </div>
          <div className="board-card">
            <Board
              room={room}
              playerId={playerId}
              onMove={index =>
                runAction('/api/rooms/' + room.code + '/move', {
                  tokenIndex: index,
                })
              }
            />
          </div>
          <div className="turn-controls">
            <div className="dice-panel">
              <button
                type="button"
                className={
                  'dice-face dice-tap-control ' +
                  (room.state.dice !== null ? 'dice-ready' : '') +
                  (room.status === 'playing' && myTurn && room.state.dice === null && !busy ? ' dice-can-roll' : '')
                }
                aria-label={room.state.dice === null ? (myTurn ? 'Tap dice to roll' : 'Waiting for your turn') : 'Dice result ' + room.state.dice}
                disabled={room.status !== 'playing' || !myTurn || busy || room.state.dice !== null}
                onClick={() => runAction('/api/rooms/' + room.code + '/roll', {})}
              >
                {room.state.dice !== null ? (
                  DICE_FACES[room.state.dice]
                ) : room.state.lastRoll ? (
                  DICE_FACES[room.state.lastRoll]
                ) : (
                  <Dice5 size={34} />
                )}
              </button>
              <div className="dice-copy">
                <b>
                  {room.state.dice !== null
                    ? 'Your move!'
                    : myTurn
                      ? 'Your turn'
                      : currentPlayer
                        ? currentPlayer.name + ' is playing'
                        : 'Waiting'}
                </b>
                <small>
                  {room.state.dice !== null
                    ? 'Choose a glowing token'
                    : currentPlayer?.isBot
                      ? 'Computer is thinking...'
                      : 'Roll to make your move'}
                </small>
              </div>
            </div>
            {room.status === 'waiting' ? (
              me.host ? (
                <button
                  className="primary-button start-button"
                  disabled={!canStart || busy}
                  onClick={() =>
                    runAction('/api/rooms/' + room.code + '/start', {})
                  }
                >
                  <span>
                    <Gamepad2 size={18} /> Start match
                  </span>
                  <ArrowRight size={18} />
                </button>
              ) : (
                <div className="waiting-host">
                  The host will start the match when everyone is ready.
                </div>
              )
            ) : room.status === 'playing' ? (
              <div className="action-buttons">
                {room.state.dice === null ? (
                  <div className="move-hint">
                    {myTurn ? 'Tap the dice to roll' : 'Waiting for the active player'}
                  </div>
                ) : noMoves ? (
                  <button
                    className="secondary-button pass-button"
                    disabled={busy}
                    onClick={() =>
                      runAction('/api/rooms/' + room.code + '/pass', {})
                    }
                  >
                    No move — pass turn <ChevronRight size={17} />
                  </button>
                ) : (
                  <div className="move-hint">
                    <Sparkles size={16} /> Tap one of your glowing tokens
                  </div>
                )}
              </div>
            ) : (
              <button
                className="primary-button start-button"
                onClick={leaveRoom}
              >
                <span>Play another match</span>
                <ArrowRight size={18} />
              </button>
            )}
          </div>
          {room.status === 'waiting' ? (
            <div className="invite-banner">
              <div className="invite-icon">
                <Users size={20} />
              </div>
              <div>
                <b>Your room is ready</b>
                <span>
                  Share the code <strong>{room.code}</strong> with your friends.
                </span>
              </div>
              <button onClick={copyCode}>
                {copied ? 'Copied!' : 'Copy invite'} <Copy size={15} />
              </button>
            </div>
          ) : null}
        </section>
        <aside
          className={'side-column chat-side-column' + (callJoined ? ' call-floating-window' : '') + (callMinimized ? ' call-is-minimized' : '')}
          style={callJoined && callWindowPosition ? { left: callWindowPosition.x, top: callWindowPosition.y } : undefined}
        >
          <section className="side-card call-card">
            <div
              className="side-card-heading call-window-drag-handle"
              onPointerDown={event => {
                if (!callJoined) return;
                event.preventDefault();
                const x = callWindowPosition?.x ?? Math.max(8, window.innerWidth - 310);
                const y = callWindowPosition?.y ?? Math.max(8, window.innerHeight - 300);
                callDragOffsetRef.current = { x: event.clientX - x, y: event.clientY - y };
                event.currentTarget.setPointerCapture(event.pointerId);
              }}
              onPointerMove={event => {
                if (!callJoined || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
                const width = Math.min(300, window.innerWidth - 24);
                const x = Math.max(8, Math.min(window.innerWidth - width - 8, event.clientX - callDragOffsetRef.current.x));
                const y = Math.max(8, Math.min(window.innerHeight - 150, event.clientY - callDragOffsetRef.current.y));
                setCallWindowPosition({ x, y });
              }}
              onPointerUp={event => {
                if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
                const width = Math.min(320, window.innerWidth - 20);
                const height = Math.min(440, window.innerHeight - 100);
                const current = callWindowPosition || { x: window.innerWidth - width - 14, y: window.innerHeight - height - 14 };
                const corners = [
                  { x: 14, y: 64 },
                  { x: window.innerWidth - width - 14, y: 64 },
                  { x: 14, y: window.innerHeight - height - 14 },
                  { x: window.innerWidth - width - 14, y: window.innerHeight - height - 14 },
                ];
                const nearest = corners.reduce((best, point) => Math.hypot(point.x - current.x, point.y - current.y) < Math.hypot(best.x - current.x, best.y - current.y) ? point : best);
                if (Math.hypot(nearest.x - current.x, nearest.y - current.y) < 72) setCallWindowPosition(nearest);
              }}
              onPointerCancel={event => {
                if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
              }}
            >
              <div>
                <span className="mini-label">LIVE HANGOUT</span>
                <h3>Voice & video</h3>
              </div>
              <div className="call-window-heading-actions"><Phone size={19}/>{callJoined ? <button type="button" className="call-minimize-button" onPointerDown={event => event.stopPropagation()} onClick={() => setCallMinimized(true)} aria-label="Minimize call window">−</button> : null}</div>
            </div>
            <p className="call-description">
              Talk face-to-face while your match keeps moving. Your mic and camera
              stay off until you choose to join.
            </p>
            <div className="call-presence">
              <span className="call-live-dot" />
              {callPlayers.length} {callPlayers.length === 1 ? 'player' : 'players'} in call
            </div>
            {!callJoined ? (
              <div className="call-actions">
                <button
                  className="call-action voice-action"
                  disabled={callBusy}
                  onClick={() => void joinCall('voice')}
                >
                  <Mic size={16} /> Join voice
                </button>
                <button
                  className="call-action video-action"
                  disabled={callBusy}
                  onClick={() => void joinCall('video')}
                >
                  <Video size={16} /> Join video
                </button>
              </div>
            ) : (
              <>

                <div className="call-grid">
                  {localStream ? (
                    <MediaTile
                      name={me.name}
                      stream={localStream}
                      local
                      video={callMode === 'video' && cameraEnabled}
                    />
                  ) : null}
                  {callPlayers
                    .filter(player => player.id !== playerId)
                    .map(player => {
                      const stream = remoteStreams[player.id];
                      return stream ? (
                        <MediaTile
                          key={player.id}
                          name={player.name}
                          stream={stream}
                          video={stream.getVideoTracks().length > 0}
                        />
                      ) : (
                        <div className="call-peer-waiting" key={player.id}>
                          <span>{player.name.slice(0, 1).toUpperCase()}</span>
                          <b>{player.name}</b>
                          <small>Connecting…</small>
                        </div>
                      );
                    })}
                </div>
                <div className="call-actions call-actions-bottom">
                  <button className="call-action call-control-button" onClick={toggleMute} aria-label={callMuted ? 'Unmute microphone' : 'Mute microphone'}>
                    {callMuted ? <Mic size={17} /> : <MicOff size={17} />}
                    <span>{callMuted ? 'Unmute' : 'Mute'}</span>
                  </button>
                  {callMode === 'video' ? (
                    <button className="call-action call-control-button" onClick={toggleCamera} aria-label={cameraEnabled ? 'Turn camera off' : 'Turn camera on'}>
                      {cameraEnabled ? <VideoOff size={17} /> : <Video size={17} />}
                      <span>{cameraEnabled ? 'Camera off' : 'Camera on'}</span>
                    </button>
                  ) : (
                    <button className="call-action call-control-button" disabled={callBusy} onClick={() => void switchToVideo()}>
                      <Video size={17} /><span>Add camera</span>
                    </button>
                  )}
                  <button className="call-action call-leave call-control-button" onClick={() => void leaveCall()} aria-label="Leave call">
                    <PhoneOff size={17} /><span>Leave</span>
                  </button>
                </div>
              </>
            )}
            {callBusy ? <small className="call-muted-note">Connecting to your call…</small> : null}
            {callError ? <div className="call-error">{callError}</div> : null}
            {!callJoined && callPlayers.length > 0 ? (
              <small className="call-muted-note">
                Join to talk with the players already here.
              </small>
            ) : null}
          </section>
          <section className="side-card players-card">
            <div className="side-card-heading">
              <div>
                <span className="mini-label">THE CREW</span>
                <h3>
                  Players <span>{room.players.length}/{room.gameMode === 'one-v-one' ? 2 : 4}</span>
                </h3>
              </div>
              <Users size={19} />
            </div>
            <div className="player-list">
              {room.players.map(player => (
                <div
                  className={
                    'player-row ' +
                    (currentPlayer?.id === player.id &&
                    room.status === 'playing'
                      ? 'player-active'
                      : '')
                  }
                  key={player.id}
                >
                  <div className={'player-avatar avatar-' + player.color}>
                    {player.name.slice(0, 1).toUpperCase()}
                  </div>
                  <div className="player-details">
                    <b>
                      {player.name}
                      {player.id === playerId ? ' (You)' : ''}
                    </b>
                    <small>
                      {room.gameMode === 'duo' ? 'Team ' + (player.teamId === 'sun' ? 'Sun' : 'Moon') + ' · ' : ''}{COLOR_NAMES[player.color]}{' '}
                      {player.isBot ? '· AI opponent' : player.host ? '· Host' : ''}
                      {(room.callParticipants || []).includes(player.id)
                        ? ' · In call'
                        : ''}
                    </small>
                  </div>
                  {player.host ? (
                    <Crown size={15} className="host-crown" />
                  ) : null}
                  {!player.isBot && player.id !== playerId ? <div className="player-safety-actions"><button type="button" title={'Report ' + player.name} aria-label={'Report ' + player.name} onClick={() => void reportPlayer(player.id)}><Flag size={13}/></button><button type="button" title={'Block ' + player.name} aria-label={'Block ' + player.name} onClick={() => void blockPlayer(player.id)}><Ban size={13}/></button></div> : null}
                  {currentPlayer?.id === player.id &&
                  room.status === 'playing' ? (
                    <span className="turn-tag">TURN</span>
                  ) : (
                    <span className="player-ready">
                      <i />
                    </span>
                  )}
                </div>
              ))}
              {Array.from({ length: (room.gameMode === 'one-v-one' ? 2 : 4) - room.players.length }, (_, index) => (
                <div className="player-row empty-player" key={'empty-' + index}>
                  <div className="player-avatar avatar-empty">
                    <Users size={16} />
                  </div>
                  <div className="player-details">
                    <b>Waiting for player</b>
                    <small>Share your room code</small>
                  </div>
                  <span className="empty-dots">•••</span>
                </div>
              ))}
            </div>
          </section>
          <section className="side-card chat-card">
            <div className="side-card-heading">
              <div>
                <span className="mini-label">LIVE CHAT</span>
                <h3>{chatMode === 'public' ? 'Public room chat' : 'Private messages'}</h3>
              </div>
              <button className="chat-close-button" onClick={() => setChatOpen(false)} aria-label="Close chat">
                <X size={18} />
              </button>
            </div>
            <div className="chat-mode-switch">
              <button className={chatMode === 'public' ? 'selected' : ''} onClick={() => setChatMode('public')}>Public</button>
              <button className={chatMode === 'private' ? 'selected' : ''} onClick={() => setChatMode('private')}>Private</button>
            </div>
            {chatMode === 'private' ? (
              <select
                className="chat-recipient-select"
                value={chatRecipientId}
                onChange={event => setChatRecipientId(event.target.value)}
              >
                <option value="">Choose a player</option>
                {room.players.filter(player => player.id !== playerId && !player.isBot).map(player => (
                  <option key={player.id} value={player.id}>{player.name}</option>
                ))}
              </select>
            ) : null}
            <div className="chat-feed">
              {visibleMessages.length === 0 ? (
                <div className="chat-empty">
                  <div>
                    <MessageCircle size={20} />
                  </div>
                  <b>{chatMode === 'public' ? 'It’s quiet in here...' : 'No private messages yet'}</b>
                  <span>{chatMode === 'public' ? 'Send the first message or drop a reaction.' : chatRecipientId ? 'Start a private conversation with this player.' : 'Invite a human player to start a private chat.'}</span>
                </div>
              ) : (
                visibleMessages.map(message => (
                  <div
                    className={
                      'chat-message ' +
                      (message.kind === 'reaction' ? 'chat-reaction' : '')
                    }
                    key={message.id}
                  >
                    {message.kind === 'chat' ? (
                      <>
                        <div className={'chat-avatar avatar-' + message.color}>
                          {message.name.slice(0, 1).toUpperCase()}
                        </div>
                        <div className="chat-bubble">
                          <b>{message.name}</b>
                          <span>{message.text}</span>
                        </div>
                      </>
                    ) : (
                      <div className="reaction-line">
                        <b>{message.name}</b>
                        <span>{message.text}</span>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
            {chatMode === 'public' ? (
            <div className="reaction-bar">
              {['😂', '🔥', '👏', '😎', '😭'].map(emoji => (
                <button
                  key={emoji}
                  disabled={busy}
                  onClick={() => sendChat(emoji, 'reaction')}
                >
                  {emoji}
                </button>
              ))}
            </div>
            ) : null}
            <form
              className="chat-form"
              onSubmit={event => {
                event.preventDefault();
                sendChat(chatText);
              }}
            >
              <input
                value={chatText}
                maxLength={140}
                onChange={event => setChatText(event.target.value)}
                placeholder={chatMode === 'public' ? 'Message everyone...' : 'Message privately...'}
                disabled={chatMode === 'private' && !chatRecipientId}
              />
              <button
                type="submit"
                disabled={!chatText.trim() || busy}
                aria-label="Send message"
              >
                <Send size={17} />
              </button>
            </form>
          </section>
          <div className="fair-play-note">
            <Shield size={16} />
            <span>
              <b>Friendly game</b> Keep it fun. Play fair and enjoy the race.
            </span>
          </div>
        </aside>
        <div className="floating-chat-stack" aria-live="polite">
          {room.messages.filter(message => !blockedPlayerIds.includes(message.playerId)).slice(-3).map(message => (
            <div className={'floating-chat-message ' + (message.kind === 'reaction' ? 'floating-reaction' : '')} key={message.id}>
              {message.kind === 'chat' ? <><b>{message.name}</b><span>{message.text}</span></> : <><b>{message.name}</b><span>{message.text}</span></>}
            </div>
          ))}
        </div>
      </div>
      {callJoined && callMinimized ? <button className="call-floating-bubble" onClick={() => { setCallMinimized(false); setChatOpen(false); setCrewOpen(false); setHangoutOpen(true); }} aria-label="Expand live call"><Phone size={18}/><span>{callPlayers.length || 1}</span></button> : null}
      {notice ? (
        <div className="toast-notice">
          <X size={15} /> {notice}
          <button onClick={() => setNotice('')} aria-label="Dismiss">
            <X size={14} />
          </button>
        </div>
      ) : null}
      <footer className="game-footer">
        LUDO LIVE <span>•</span> GOOD LUCK, HAVE FUN
      </footer>
    </main>
  );
}
