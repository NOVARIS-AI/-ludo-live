/**
 * Authenticated browser WebSocket adapter.
 * The bearer session is exchanged for a short-lived, single-use ticket so the
 * long-lived account token is never placed in the WebSocket URL.
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
  const apiOrigin = (import.meta.env.VITE_API_BASE_URL || '').trim().replace(/\/$/, '');
  const endpoint = explicitEndpoint || (apiOrigin ? apiOrigin.replace(/^https:/, 'wss:').replace(/^http:/, 'ws:') + '/connect' : '');
  const messages: Array<(message: RealtimeMessage) => void> = [];
  const opens: Array<() => void> = [];
  const closes: Array<() => void> = [];
  const errors: Array<(error: Event) => void> = [];
  let socket: WebSocket | null = null;
  let opened = false;
  let disconnected = false;
  let resolveReady!: () => void;
  let rejectReady!: (reason: Error) => void;
  const ready = new Promise<void>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });

  const fail = (message: string) => {
    const error = new Error(message);
    rejectReady(error);
  };

  if (!endpoint) {
    fail('Realtime service is not configured yet.');
  } else {
    void (async () => {
      try {
        const token = localStorage.getItem('ludo-live-auth-token') || '';
        if (!token) throw new Error('Sign in to connect to realtime.');
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
        socket = new WebSocket(url.toString());
        socket.addEventListener('open', () => {
          opened = true;
          resolveReady();
          opens.forEach(callback => callback());
        });
        socket.addEventListener('message', event => {
          if (typeof event.data !== 'string') return;
          try {
            const message = JSON.parse(event.data) as RealtimeMessage;
            messages.forEach(callback => callback(message));
          } catch { /* Ignore malformed frames and keep the connection alive. */ }
        });
        socket.addEventListener('close', () => {
          if (!opened) fail('Realtime connection closed before opening.');
          closes.forEach(callback => callback());
        });
        socket.addEventListener('error', event => {
          if (!opened) fail('Could not connect to the realtime service.');
          errors.forEach(callback => callback(event));
        });
      } catch (error) {
        fail(error instanceof Error ? error.message : 'Could not authorize realtime connection.');
      }
    })();
  }

  return {
    connectionId,
    ready,
    onMessage: callback => messages.push(callback),
    onOpen: callback => { opens.push(callback); if (opened) callback(); },
    onClose: callback => closes.push(callback),
    onError: callback => errors.push(callback),
    disconnect: () => {
      disconnected = true;
      if (socket && socket.readyState < WebSocket.CLOSING) socket.close(1000, 'client disconnect');
    },
  };
}

export const ws = { connect: createConnection };
