/** Typed fetch wrapper: same-origin cookies, CSRF double-submit header, one silent refresh on 401. */
export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public issues?: unknown[]) {
    super(message);
  }
}

const BASE = '/api/v1';

function csrf(): string {
  if (typeof document === 'undefined') return '';
  const m = document.cookie.match(/(?:^|; )evida_csrf=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : '';
}

let refreshing: Promise<boolean> | null = null;
async function refresh(): Promise<boolean> {
  refreshing ??= fetch(`${BASE}/auth/refresh`, { method: 'POST', credentials: 'same-origin' })
    .then((r) => r.ok)
    .finally(() => setTimeout(() => (refreshing = null), 0));
  return refreshing;
}

export interface RequestOpts {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  candidateToken?: string;
  raw?: boolean;
}

export async function api<T = any>(path: string, opts: RequestOpts = {}, retried = false): Promise<T> {
  const headers: Record<string, string> = {};
  const isForm = typeof FormData !== 'undefined' && opts.body instanceof FormData;
  if (opts.body !== undefined && !isForm) headers['content-type'] = 'application/json';
  if (opts.method && opts.method !== 'GET') headers['x-csrf-token'] = csrf();
  if (opts.candidateToken) headers['x-candidate-token'] = opts.candidateToken;
  const res = await fetch(`${BASE}${path}`, {
    method: opts.method ?? 'GET',
    credentials: 'same-origin',
    headers,
    body: opts.body === undefined ? undefined : isForm ? (opts.body as FormData) : JSON.stringify(opts.body),
  });
  if (res.status === 401 && !retried && !opts.candidateToken && !path.startsWith('/auth/')) {
    if (await refresh()) return api<T>(path, opts, true);
    if (typeof window !== 'undefined' && !location.pathname.startsWith('/login')) location.href = `/login?next=${encodeURIComponent(location.pathname)}`;
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, body.code ?? String(res.status), body.message ?? res.statusText, body.issues);
  }
  if (opts.raw) return res as unknown as T;
  if (res.status === 204) return undefined as T;
  const ct = res.headers.get('content-type') ?? '';
  return (ct.includes('json') ? res.json() : res.text()) as Promise<T>;
}

export const get = <T = any>(p: string) => api<T>(p);
export const post = <T = any>(p: string, body?: unknown) => api<T>(p, { method: 'POST', body: body ?? {} });
export const put = <T = any>(p: string, body?: unknown) => api<T>(p, { method: 'PUT', body });
export const patch = <T = any>(p: string, body?: unknown) => api<T>(p, { method: 'PATCH', body });
export const del = <T = any>(p: string) => api<T>(p, { method: 'DELETE' });

/** Wait for a queued AI task to finish (used by "Draft with AI" actions). */
export async function waitForJob(queue: string, id: string, onTick?: (state: string) => void, timeoutMs = 180_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const s = await get<{ state: string; failedReason: string | null }>(`/ai/jobs/${queue}/${encodeURIComponent(id)}`);
    onTick?.(s.state);
    if (s.state === 'completed') return s;
    if (s.state === 'failed') throw new ApiError(500, 'AI_FAILED', s.failedReason ?? 'AI processing failed');
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new ApiError(504, 'AI_TIMEOUT', 'AI processing is taking longer than expected');
}
