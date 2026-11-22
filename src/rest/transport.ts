import { setTimeout as delay } from 'node:timers/promises';
import { MicupAPIError, retryDelay } from './errors.js';

export type RestMethod = 'GET' | 'HEAD' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

export interface MicupLogger {
  warn(message: string, fields?: Record<string, unknown>): void;
}

export interface MicupRequestOptions {
  signal?: AbortSignal;
}

export interface RestRequestOptions extends MicupRequestOptions {
  body?: unknown;
  query?: URLSearchParams;
  reason?: string;
  anonymous?: boolean;
  idempotent?: boolean;
}

const permissionLogWindow = 60_000;
const permissionLogLimit = 512;
const majorParameters = new Set(['channels', 'guilds', 'webhooks']);
const maxRetryDelay = 30_000;
const repeatable = new Set<RestMethod>(['GET', 'HEAD', 'PUT', 'DELETE']);
const snowflake = /^\d+$/;

function routeKey(method: RestMethod, path: string): string {
  const parts = path.split('/');
  return method + ' ' + parts.map((part, index) => {
    if (parts[index - 1] === 'reactions') return '{emoji}';
    if (parts[index - 2] === 'webhooks' && snowflake.test(parts[index - 1])) return '{token}';
    return snowflake.test(part) && !majorParameters.has(parts[index - 1]) ? '{id}' : part;
  }).join('/');
}

class RateLimits {
  readonly #reset = new Map<string, number>();
  #global = 0;

  async wait(route: string, signal?: AbortSignal): Promise<void> {
    while (true) {
      signal?.throwIfAborted();
      const wait = Math.max(this.#global, this.#reset.get(route) ?? 0) - performance.now();
      if (wait <= 0) {
        this.#reset.delete(route);
        return;
      }
      await delay(Math.ceil(wait), undefined, { signal });
    }
  }

  block(route: string, wait: number, global = false): void {
    if (!wait) return;
    const now = performance.now();
    if (global) {
      this.#global = Math.max(this.#global, now + wait);
      return;
    }
    this.#reset.set(route, Math.max(this.#reset.get(route) ?? 0, now + wait));
    if (this.#reset.size > 4096) {
      for (const [key, until] of this.#reset) {
        if (until <= now) this.#reset.delete(key);
      }
    }
  }
}

async function readJson(response: Response, limit: number): Promise<unknown> {
  if (!response.body) return undefined;
  if (Number(response.headers.get('content-length')) > limit) {
    await response.body.cancel();
    throw new RangeError('Micup API response exceeds its size limit');
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.length;
      if (size > limit) {
        await reader.cancel();
        throw new RangeError('Micup API response exceeds its size limit');
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  return size ? JSON.parse(Buffer.concat(chunks, size).toString('utf8')) : undefined;
}

export class RestTransport {
  readonly #limits = new RateLimits();
  readonly #api: URL;
  readonly #denied = new Map<string, number>();

  constructor(api: string, private readonly token: string, private readonly attempts = 5, private readonly logger?: MicupLogger) {
    this.#api = new URL(api + '/');
    if (!Number.isSafeInteger(attempts) || attempts < 1 || attempts > 5) {
      throw new RangeError('Micup REST attempts must be between 1 and 5');
    }
  }

  #notePermissionDenied(method: RestMethod, path: string, error: MicupAPIError): void {
    if (!this.logger || error.status !== 403 || (error.code !== 'MISSING_PERMISSIONS' && error.code !== 'MISSING_ACCESS')) return;
    const key = method + ' ' + path;
    const now = performance.now();
    const last = this.#denied.get(key);
    if (last !== undefined && now - last < permissionLogWindow) return;
    if (this.#denied.size >= permissionLogLimit) {
      for (const [stored, at] of this.#denied) if (now - at >= permissionLogWindow) this.#denied.delete(stored);
      if (this.#denied.size >= permissionLogLimit) this.#denied.clear();
    }
    this.#denied.set(key, now);
    const guildId = /^\/guilds\/(\d+)/.exec(path)?.[1];
    try {
      this.logger.warn('bot lacks permission for this request', {
        method, path, code: error.code, ...(guildId && { guild: guildId }), ...(error.message && { message: error.message }),
      });
    } catch {}
  }

  async request<T>(method: RestMethod, path: string, { body, signal, query, reason, anonymous, idempotent }: RestRequestOptions = {}): Promise<T> {
    if (!path.startsWith('/') || path.startsWith('//') || /[\\?#\u0000-\u0020]/.test(path)) {
      throw new TypeError('Micup REST path must be relative to the versioned API');
    }
    const target = new URL('.' + path, this.#api);
    if (target.origin !== this.#api.origin || !target.pathname.startsWith(this.#api.pathname)) {
      throw new TypeError('Micup REST path must be relative to the versioned API');
    }
    if (query?.size) target.search = query.toString();

    const headers = new Headers({ 'User-Agent': 'micup.ts' });
    if (!anonymous) headers.set('Authorization', 'Bot ' + this.token);
    const canRetry = idempotent || repeatable.has(method);
    if (reason !== undefined) {
      if (typeof reason !== 'string' || !reason.trim() || reason.length > 512 || /[\r\n]/.test(reason)) {
        throw new TypeError('Invalid Micup audit log reason');
      }
      headers.set('X-Audit-Log-Reason', encodeURIComponent(reason.trim()));
    }
    const multipart = body instanceof FormData;
    if (body !== undefined && !multipart) headers.set('Content-Type', 'application/json');
    const payload = multipart ? body : JSON.stringify(body);
    const route = routeKey(method, target.pathname.slice(this.#api.pathname.length - 1));
    let last: unknown;

    for (let attempt = 0; attempt < this.attempts; attempt++) {
      await this.#limits.wait(route, signal);
      const backoff = 500 * 2 ** attempt;
      const remaining = attempt + 1 < this.attempts;
      let response: Response;
      try {
        response = await fetch(target.href, { method, headers, body: payload, signal, redirect: 'error' });
      } catch {
        signal?.throwIfAborted();
        last = new Error('Micup API connection failed');
        if (!remaining || !canRetry) throw last;
        await delay(backoff, undefined, { signal });
        continue;
      }

      if (response.headers.get('x-ratelimit-remaining') === '0') {
        this.#limits.block(route, retryDelay(response.headers.get('x-ratelimit-reset-after')));
      }
      if (response.ok) return await readJson(response, 2 * 1024 * 1024) as T;

      const errorBody = await readJson(response, 64 * 1024).catch(() => undefined);
      signal?.throwIfAborted();
      const error = new MicupAPIError(response, errorBody as ConstructorParameters<typeof MicupAPIError>[1]);
      last = error;
      this.#notePermissionDenied(method, target.pathname.slice(this.#api.pathname.length - 1), error);
      let wait = 0;
      if (response.status === 429) {
        wait = Math.max(error.retryAfterMs, 1);
        this.#limits.block(route, wait, error.global);
      } else if (response.status === 423) {
        wait = Math.max(error.retryAfterMs, 1000);
      } else if (response.status >= 500 && canRetry) {
        wait = Math.max(error.retryAfterMs, backoff);
      }
      if (!remaining || wait === 0 || wait > maxRetryDelay) throw error;
      await delay(wait, undefined, { signal });
    }
    throw last;
  }
}
