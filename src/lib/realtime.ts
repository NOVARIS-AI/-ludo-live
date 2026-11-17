/**
 * Browser WebSocket adapter matching the small interface previously provided
 * by the AppDeploy client. The Worker endpoint must accept a `connection_id` query
 * parameter and publish the existing entity.update message envelope.
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
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return 'conn-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function createConnection(): RealtimeConnection {
  const connectionId = makeConnectionId();
  const endpoint = (import.meta.env.VITE_REALTIME_URL || '').trim();
  const messages: Array<(message: RealtimeMessage) => void> = [];
  const opens: Array<() => void> = [];
  const closes: Array<() => void> = [];
  const errors: Array<(error: Event) => void> = [];

  let socket: WebSocket | null = null;
  let opened = false;
  let resolveReady!: () => void;
  let rejectReady!: (reason: Error) => void;
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });

  if (!endpoint) {
    rejectReady(new Error('Realtime service is not configured yet.'));
  } else {
    try {
      const url = new URL(endpoint);
      url.searchParams.set('connection_id', connectionId);
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
        } catch {
          // Ignore malformed frames; the next valid event can still be handled.
        }
      });
      socket.addEventListener('close', () => {
        if (!opened) rejectReady(new Error('Realtime connection closed before opening.'));
        closes.forEach(callback => callback());
      });
      socket.addEventListener('error', event => {
        if (!opened) rejectReady(new Error('Could not connect to the realtime service.'));
        errors.forEach(callback => callback(event));
      });
    } catch {
      rejectReady(new Error('The realtime service URL is invalid.'));
    }
  }

  return {
    connectionId,
    ready,
    onMessage: callback => messages.push(callback),
    onOpen: callback => {
      opens.push(callback);
      if (opened) callback();
    },
    onClose: callback => closes.push(callback),
    onError: callback => errors.push(callback),
    disconnect: () => {
      if (socket && socket.readyState < WebSocket.CLOSING) socket.close(1000, 'client disconnect');
    },
  };
}

export const ws = {
  connect: createConnection,
};
