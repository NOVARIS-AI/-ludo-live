/**
 * Authenticated browser WebSocket adapter.
 * A bearer session is exchanged for a short-lived, single-use ticket on every
 * connection attempt. The long-lived account token never appears in a WS URL.
 */
export type RealtimeMessage = { type?: string; payload?: unknown; [key: string]: unknown };
export type RealtimeConnection = {
  connectionId: string;
  ready: Promise<void>;
  onMessage(callback: (message: RealtimeMessage) => void): void;
  onOpen(callback: () => void): void;
  onClose(callback: () => void): void;
  onError(callback: (error: Event) => void): void;
  disconnect(): void;
};

function makeConnectionId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return 'conn-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function createConnection(): RealtimeConnection {
  const connectionId = makeConnectionId();
  const explicitEndpoint = (import.meta.env.VITE_REALTIME_URL || '').trim();
  const apiOrigin = (import.meta.env.VITE_API_BASE_URL || '').trim().replace(/\/+$/, '');
  const endpoint = explicitEndpoint || (apiOrigin ? apiOrigin.replace(/^https:/, 'wss:').replace(/^http:/, 'ws:') + '/connect' : '');
  const messages: Array<(message: RealtimeMessage) => void> = [];
  const opens: Array<() => void> = [];
  const closes: Array<() => void> = [];
  const errors: Array<(error: Event) => void> = [];
  let socket: WebSocket | null = null;
  let isOpen = false;
  let disconnected = false;
  let connecting = false;
  let attempts = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let resolveReady!: () => void;
  let rejectReady!: (reason: Error) => void;
  const ready = new Promise<void>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });

  const rejectInitial = (message: string) => rejectReady(new Error(message));
  const scheduleReconnect = () => {
    if (disconnected || reconnectTimer) return;
    const delay = Math.min(30_000, 1_000 * 2 ** Math.min(attempts, 5)) + Math.floor(Math.random() * 350);
    attempts += 1;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      void connect();
    }, delay);
  };

  const connect = async () => {
    if (disconnected || connecting || isOpen) return;
    if (!endpoint) { rejectInitial('Realtime service is not configured yet.'); return; }
    const token = localStorage.getItem('ludo-live-auth-token') || '';
    if (!token) { rejectInitial('Sign in to connect to realtime.'); return; }
    connecting = true;
    try {
      const ticketResponse = await fetch(apiOrigin + '/api/auth/realtime-ticket', {
        method: 'POST',
        headers: { Accept: 'application/json', Authorization: 'Bearer ' + token },
      });
      const ticketData = await ticketResponse.json().catch(() => ({})) as { ticket?: string; error?: string };
      if (!ticketResponse.ok || !ticketData.ticket) throw new Error(ticketData.error || 'Could not authorize realtime connection.');
      if (disconnected) return;
      const url = new URL(endpoint);
      url.searchParams.set('connection_id', connectionId);
      url.searchParams.set('ticket', ticketData.ticket);
      const nextSocket = new WebSocket(url.toString());
      socket = nextSocket;
      nextSocket.addEventListener('open', () => {
        if (disconnected) { nextSocket.close(1000, 'client disconnect'); return; }
        connecting = false;
        isOpen = true;
        attempts = 0;
        resolveReady();
        opens.forEach(callback => callback());
      });
      nextSocket.addEventListener('message', event => {
        if (typeof event.data !== 'string') return;
        try {
          const message = JSON.parse(event.data) as RealtimeMessage;
          messages.forEach(callback => callback(message));
        } catch { /* Ignore malformed frames and keep the connection alive. */ }
      });
      nextSocket.addEventListener('close', () => {
        connecting = false;
        isOpen = false;
        if (!disconnected) {
          closes.forEach(callback => callback());
          scheduleReconnect();
        } else if (socket === nextSocket) socket = null;
      });
      nextSocket.addEventListener('error', event => {
        if (!isOpen) rejectInitial('Could not connect to the realtime service.');
        errors.forEach(callback => callback(event));
      });
    } catch (error) {
      connecting = false;
      if (!isOpen) rejectInitial(error instanceof Error ? error.message : 'Could not authorize realtime connection.');
      scheduleReconnect();
    }
  };

  void connect();
  return {
    connectionId,
    ready,
    onMessage: callback => messages.push(callback),
    onOpen: callback => { opens.push(callback); if (isOpen) callback(); },
    onClose: callback => closes.push(callback),
    onError: callback => errors.push(callback),
    disconnect: () => {
      disconnected = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = null;
      if (socket && socket.readyState < WebSocket.CLOSING) socket.close(1000, 'client disconnect');
      socket = null;
      isOpen = false;
    },
  };
}

export const ws = { connect: createConnection };
