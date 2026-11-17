/**
 * Fetch-based API adapter. Empty VITE_API_BASE_URL means same-origin /api.
 * For a separate Worker, set VITE_API_BASE_URL to its HTTPS origin.
 */
type ApiEnvelope<T> = { data: T };
type ErrorPayload = { error?: string; message?: string; [key: string]: unknown };

export class ApiError extends Error {
  readonly response: { status: number; data: ErrorPayload };

  constructor(status: number, data: ErrorPayload) {
    super(data.error || data.message || `Request failed (${status})`);
    this.name = 'ApiError';
    this.response = { status, data };
  }
}

let authToken = '';
export function setAuthToken(token:string) { authToken=token; }
const configuredBase = (import.meta.env.VITE_API_BASE_URL || '').trim();
let API_BASE = configuredBase;
while (API_BASE.endsWith('/')) API_BASE = API_BASE.slice(0, -1);

async function request<T>(
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
): Promise<ApiEnvelope<T>> {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const response = await fetch(`${API_BASE}${normalizedPath}`, {
    method,
    credentials: 'same-origin',
    headers: {
      Accept: 'application/json',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(authToken ? { Authorization: 'Bearer ' + authToken } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

  const raw = await response.text();
  let data: unknown = null;
  if (raw) {
    try {
      data = JSON.parse(raw);
    } catch {
      data = { message: raw };
    }
  }

  if (!response.ok) {
    const payload: ErrorPayload =
      data && typeof data === 'object'
        ? (data as ErrorPayload)
        : { message: String(data || response.statusText) };
    throw new ApiError(response.status, payload);
  }

  return { data: data as T };
}

export const api = {
  get<T = any>(path: string): Promise<ApiEnvelope<T>> {
    return request<T>('GET', path);
  },
  post<T = any>(path: string, body: unknown): Promise<ApiEnvelope<T>> {
    return request<T>('POST', path, body);
  },
};
