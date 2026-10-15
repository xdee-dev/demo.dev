/** Thin fetch wrapper: session cookie + CSRF header + active company header + structured errors. */
let csrfToken: string | null = null;
let companyId: string | null = null;
let onUnauthorized: (() => void) | null = null;

export const setCsrf = (t: string | null) => { csrfToken = t; };
export const setCompany = (id: string | null) => { companyId = id; };
export const getCompany = () => companyId;
export const setOnUnauthorized = (fn: () => void) => { onUnauthorized = fn; };

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: { fields?: Record<string, string>; [k: string]: unknown }) {
    super(message);
  }
}

function headers(extra?: HeadersInit, json = true): Headers {
  const h = new Headers(extra);
  if (json) h.set('Content-Type', 'application/json');
  if (csrfToken) h.set('X-CSRF-Token', csrfToken);
  if (companyId) h.set('X-Company-Id', companyId);
  return h;
}

async function handle<T>(res: Response): Promise<T> {
  // Session expired while using the app → back to login. Auth endpoints (login, me, token-info…) are excluded:
  // a 401 there is expected for logged-out visitors and must not wipe the page's data.
  if (res.status === 401 && onUnauthorized && !new URL(res.url, location.origin).pathname.startsWith('/api/auth/')) onUnauthorized();
  const type = res.headers.get('content-type') ?? '';
  if (!res.ok) {
    let body: { error?: { code: string; message: string; details?: Record<string, unknown> } } = {};
    if (type.includes('json')) body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, body.error?.code ?? 'HTTP_' + res.status, body.error?.message ?? 'Permintaan gagal. Periksa koneksi lalu coba lagi.', body.error?.details);
  }
  if (type.includes('json')) return res.json() as Promise<T>;
  return undefined as T;
}

export const api = {
  get: <T = unknown>(url: string, params?: Record<string, unknown>) => fetch(withQuery(url, params), { headers: headers(undefined, false), credentials: 'same-origin' }).then((r) => handle<T>(r)),
  post: <T = unknown>(url: string, body?: unknown, extra?: HeadersInit) =>
    fetch('/api' + url, { method: 'POST', headers: headers(extra), body: JSON.stringify(body ?? {}), credentials: 'same-origin' }).then((r) => handle<T>(r)),
  put: <T = unknown>(url: string, body?: unknown) =>
    fetch('/api' + url, { method: 'PUT', headers: headers(), body: JSON.stringify(body ?? {}), credentials: 'same-origin' }).then((r) => handle<T>(r)),
  patch: <T = unknown>(url: string, body?: unknown) =>
    fetch('/api' + url, { method: 'PATCH', headers: headers(), body: JSON.stringify(body ?? {}), credentials: 'same-origin' }).then((r) => handle<T>(r)),
  upload: <T = unknown>(url: string, form: FormData) =>
    fetch('/api' + url, { method: 'POST', headers: headers(undefined, false), body: form, credentials: 'same-origin' }).then((r) => handle<T>(r)),
  /** Authenticated download (export files) → triggers a browser download. */
  download: async (url: string, params?: Record<string, unknown>) => {
    const res = await fetch(withQuery(url, params), { headers: headers(undefined, false), credentials: 'same-origin' });
    if (!res.ok) await handle(res);
    const blob = await res.blob();
    const cd = res.headers.get('content-disposition') ?? '';
    const name = decodeURIComponent(cd.match(/filename="?([^";]+)"?/)?.[1] ?? 'download');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  },
  /** Object URL for an authenticated file (images, PDFs). */
  fileUrl: async (id: string) => {
    const res = await fetch(`/api/files/${id}`, { headers: headers(undefined, false), credentials: 'same-origin' });
    if (!res.ok) throw new ApiError(res.status, 'FILE', 'File tidak dapat dimuat');
    return URL.createObjectURL(await res.blob());
  },
};

export function withQuery(url: string, params?: Record<string, unknown>) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params ?? {})) if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
  const s = qs.toString();
  return '/api' + url + (s ? (url.includes('?') ? '&' : '?') + s : '');
}

export const newIdempotencyKey = () => (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`).replace(/[^A-Za-z0-9_-]/g, '');

export interface Paged<T> { data: T[]; page: number; pageSize: number; total: number; totalPages: number; sum?: string }
