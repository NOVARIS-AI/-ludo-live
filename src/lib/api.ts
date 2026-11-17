/**
 * Small fetch-based API client used by the Ludo Live browser app.
 *
 * Set VITE_API_BASE_URL when the API is hosted separately from the Pages app.
 * Leave it empty for a same-origin /api deployment.
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

const configuredBase = (import.meta.env.VITE_API_BASE_URL || '').trim();
const API_BASE = configuredBase.replace(/\\/+$/, '');

async function request<T>(
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
): Promise<ApiEnvelope<T>> {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const response = await fetch(`${API_BASE}${normalizedPath}`, {
    method,
    credentials: 'include',
    headers: body === undefined
      ? { Accept: 'application/json' }
      : { Accept: 'application/json', 'Content-Type': 'application/json' },
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
    const payload =
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
