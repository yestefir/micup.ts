import { setTimeout as delay } from 'node:timers/promises';
import { CommandWindow } from '../gateway/window.js';
import { MicupAPIError, retryDelay } from './errors.js';

export type RestMethod = 'GET' | 'HEAD' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

export interface MicupLogger {
  warn(message: string, fields?: Record<string, unknown>): void;
  info?(message: string, fields?: Record<string, unknown>): void;
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
const globalBudget = 45;
const globalWindow = 1000;
const guardWindow = 60_000;
const guardTableLimit = 1024;
const authenticationLimit = 3;
const exemptFromGlobal = /^\/(?:webhooks\/\d+\/[^/]+|interactions\/\d+\/[^/]+\/callback)(?:\/|$)/;
const idle = new AbortController().signal;
const majorParameters = new Set(['channels', 'guilds', 'webhooks']);
const maxRetryDelay = 30_000;
const repeatable = new Set<RestMethod>(['GET', 'HEAD', 'PUT', 'DELETE']);
const snowflake = /^\d+$/;
const routeTableLimit = 4096;

function routeKey(method: RestMethod, path: string): string {
  const parts = path.split('/');
  return method + ' ' + parts.map((part, index) => {
    if (parts[index - 1] === 'reactions') return '{emoji}';
    if ((parts[index - 2] === 'webhooks' || parts[index - 2] === 'interactions') && snowflake.test(parts[index - 1])) return '{token}';
    return snowflake.test(part) && !majorParameters.has(parts[index - 1]) ? '{id}' : part;
  }).join('/');
}

interface Bucket {
  known: boolean;
  limit: number;
  tokens: number;
  at: number;
  rate: number;
  inFlight: number;
  blockedUntil: number;
  waiters: Set<() => void>;
  fifo: object[];
}

interface Lease {
  complete(headers?: Headers): void;
}

const bucketTableLimit = 4096;

class RateLimits {
  readonly #buckets = new Map<string, Bucket>();
  readonly #routes = new Map<string, string>();
  #global = 0;

  #bucket(route: string): Bucket {
    const mapped = this.#routes.get(route);
    if (mapped !== undefined) {
      this.#routes.delete(route);
      this.#routes.set(route, mapped);
    }
    const key = mapped ?? route;
    let bucket = this.#buckets.get(key);
    if (!bucket) {
      bucket = { known: false, limit: Infinity, tokens: Infinity, at: 0, rate: 0, inFlight: 0, blockedUntil: 0, waiters: new Set(), fifo: [] };
      this.#buckets.set(key, bucket);
      if (this.#buckets.size > bucketTableLimit) {
        for (const [stored, candidate] of this.#buckets) {
          if (!candidate.inFlight && !candidate.waiters.size && candidate !== bucket) this.#buckets.delete(stored);
          if (this.#buckets.size <= bucketTableLimit / 2) break;
        }
      }
    }
    return bucket;
  }

  async acquire(route: string, signal?: AbortSignal): Promise<Lease> {
    const ticket = {};
    let queued: Bucket | undefined;
    const leave = () => {
      if (!queued) return;
      const index = queued.fifo.indexOf(ticket);
      if (index >= 0) queued.fifo.splice(index, 1);
      for (const wake of [...queued.waiters]) wake();
      queued = undefined;
    };
    let bucket: Bucket;
    try {
      while (true) {
        signal?.throwIfAborted();
        bucket = this.#bucket(route);
        if (queued !== bucket) {
          leave();
          bucket.fifo.push(ticket);
          queued = bucket;
        }
        const now = performance.now();
        let wait = Math.max(this.#global - now, bucket.blockedUntil - now, 0);
        if (!wait) {
          if (bucket.fifo[0] !== ticket) wait = -1;
          else if (!bucket.known) {
            if (bucket.inFlight > 0) wait = -1;
          } else if (bucket.limit !== Infinity) {
            const free = Math.min(bucket.limit, bucket.tokens + Math.max(0, now - bucket.at) * bucket.rate) - bucket.inFlight;
            if (free < 1) wait = bucket.rate > 0 ? Math.max(1, Math.ceil((1 - free) / bucket.rate)) : bucket.inFlight > 0 ? -1 : 1000;
          }
        }
        if (!wait) break;
        await this.#sleep(bucket, wait, signal);
      }
    } catch (error) {
      leave();
      throw error;
    }
    const leased = bucket;
    leased.inFlight++;
    leave();
    let done = false;
    return {
      complete: (headers) => {
        if (done) return;
        done = true;
        leased.inFlight--;
        const target = headers ? this.#learn(route, leased, headers) : leased;
        if (!headers && !leased.known && !leased.inFlight) leased.known = true;
        for (const wake of [...leased.waiters, ...target.waiters]) wake();
      },
    };
  }

  #learn(route: string, leased: Bucket, headers: Headers): Bucket {
    let bucket = leased;
    const id = headers.get('x-ratelimit-bucket');
    if (id) {
      const shared = this.#buckets.get(id);
      if (shared) bucket = shared;
      else this.#buckets.set(id, leased);
      this.#routes.delete(route);
      this.#routes.set(route, id);
      if (this.#routes.size > routeTableLimit) {
        const oldest = this.#routes.keys().next().value;
        if (oldest !== undefined) this.#routes.delete(oldest);
      }
    }
    const limit = Number(headers.get('x-ratelimit-limit'));
    const remaining = Number(headers.get('x-ratelimit-remaining'));
    const resetAfter = Number(headers.get('x-ratelimit-reset-after'));
    const now = performance.now();
    if (headers.get('x-ratelimit-remaining') !== null && remaining <= 0 && Number.isFinite(resetAfter) && resetAfter > 0) {
      bucket.blockedUntil = Math.max(bucket.blockedUntil, now + resetAfter * 1000);
    }
    if (headers.get('x-ratelimit-limit') === null || !Number.isFinite(limit) || !Number.isFinite(remaining) || limit < 1) {
      if (!bucket.known) {
        bucket.known = true;
        bucket.limit = Infinity;
      }
      if (!leased.known) leased.known = true;
      return bucket;
    }
    const projected = Math.min(limit, bucket.tokens + Math.max(0, now - bucket.at) * bucket.rate);
    bucket.known = true;
    bucket.limit = limit;
    bucket.tokens = bucket.inFlight > 0 && bucket.at > 0 ? Math.min(remaining, projected) : remaining;
    bucket.at = now;
    if (Number.isFinite(resetAfter) && resetAfter > 0 && limit > remaining) bucket.rate = (limit - remaining) / (resetAfter * 1000);
    if (!leased.known) leased.known = true;
    return bucket;
  }

  #sleep(bucket: Bucket, wait: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        bucket.waiters.delete(finish);
        signal?.removeEventListener('abort', abort);
        resolve();
      };
      const abort = () => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        bucket.waiters.delete(finish);
        signal?.removeEventListener('abort', abort);
        reject(signal?.reason);
      };
      bucket.waiters.add(finish);
      signal?.addEventListener('abort', abort, { once: true });
      if (wait > 0) timer = setTimeout(finish, Math.ceil(wait));
      if (signal?.aborted) abort();
    });
  }

  block(route: string, wait: number, global = false): void {
    if (!wait) return;
    const now = performance.now();
    if (global) {
      this.#global = Math.max(this.#global, now + wait);
      return;
    }
    const bucket = this.#bucket(route);
    bucket.blockedUntil = Math.max(bucket.blockedUntil, now + wait);
    if (!bucket.known) {
      bucket.known = true;
      bucket.limit = Infinity;
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
  readonly #pace = new CommandWindow(globalBudget, globalWindow);
  readonly #rejected = new Map<string, { count: number; since: number; until: number; error: MicupAPIError }>();
  #unauthorized = { count: 0, since: 0, until: 0, error: undefined as MicupAPIError | undefined };

  constructor(
    api: string, private readonly token: string, private readonly attempts = 5, private readonly logger?: MicupLogger,
    private readonly rejectionLimit = 5,
  ) {
    if (!Number.isSafeInteger(rejectionLimit) || rejectionLimit < 0) throw new RangeError('The rejected request limit must be a nonnegative integer');
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

  #recordRejection(key: string, error: MicupAPIError, authenticated: boolean): void {
    if (!this.rejectionLimit || ![401, 403, 404].includes(error.status)) return;
    const now = performance.now();
    if (error.status === 401 && authenticated) {
      const state = this.#unauthorized;
      if (now - state.since > guardWindow) {
        state.count = 0;
        state.since = now;
      }
      state.count++;
      if (state.count >= authenticationLimit) {
        state.until = now + guardWindow;
        state.error = error;
      }
    }
    let entry = this.#rejected.get(key);
    if (!entry || now - entry.since > guardWindow) {
      entry = { count: 0, since: now, until: 0, error };
      this.#rejected.set(key, entry);
      if (this.#rejected.size > guardTableLimit) this.#rejected.delete(this.#rejected.keys().next().value as string);
    }
    entry.count++;
    entry.error = error;
    if (entry.count >= this.rejectionLimit) entry.until = now + guardWindow;
  }

  #assertNotRejected(key: string, authenticated: boolean): void {
    if (!this.rejectionLimit) return;
    const now = performance.now();
    if (authenticated && this.#unauthorized.until > now && this.#unauthorized.error) throw this.#unauthorized.error;
    const entry = this.#rejected.get(key);
    if (entry && entry.until > now) throw entry.error;
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
    const relative = target.pathname.slice(this.#api.pathname.length - 1);
    const route = routeKey(method, relative);
    const guardKey = method + ' ' + relative;
    const authenticated = !anonymous;
    const countsGlobally = authenticated && !exemptFromGlobal.test(relative);
    this.#assertNotRejected(guardKey, authenticated);
    let last: unknown;

    for (let attempt = 0; attempt < this.attempts; attempt++) {
      const lease = await this.#limits.acquire(route, signal);
      if (countsGlobally) {
        try {
          await this.#pace.acquire(signal ?? idle);
        } catch (error) {
          lease.complete();
          throw error;
        }
      }
      const backoff = 500 * 2 ** attempt;
      const remaining = attempt + 1 < this.attempts;
      let response: Response;
      try {
        response = await fetch(target.href, { method, headers, body: payload, signal, redirect: 'error' });
      } catch (cause) {
        lease.complete();
        signal?.throwIfAborted();
        last = new Error('Micup API connection failed', { cause });
        if (!remaining || !canRetry) throw last;
        await delay(backoff, undefined, { signal });
        continue;
      }

      lease.complete(response.headers);
      if (response.ok) {
        this.#rejected.delete(guardKey);
        if (authenticated) this.#unauthorized.count = 0;
        return await readJson(response, 2 * 1024 * 1024) as T;
      }

      const errorBody = await readJson(response, 64 * 1024).catch(() => undefined);
      signal?.throwIfAborted();
      const error = new MicupAPIError(response, errorBody as ConstructorParameters<typeof MicupAPIError>[1]);
      last = error;
      this.#notePermissionDenied(method, relative, error);
      this.#recordRejection(guardKey, error, authenticated);
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
