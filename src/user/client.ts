import { MicupAPIError } from '../rest/errors.js';
import { maxDiscoveryResponseBytes, readLimitedJson } from '../rest/json.js';
import { RestTransport, type MicupLogger, type MicupRequestOptions } from '../rest/transport.js';
import type { MicupUser } from '../model/entities.js';

const defaultOrigin = 'https://micup.gg';
const connection = Symbol('Micup user connection');
const profileFields = new Set(['username', 'global_name', 'avatar', 'banner', 'bio', 'pronouns', 'accent_color', 'mention_flags']);

export interface MicupUserSessionOptions {
  token: string;
  origin?: string;
  maxRestAttempts?: number;
  logger?: MicupLogger;
}

export interface UserProfileEdit {
  username?: string;
  global_name?: string | null;
  avatar?: string | null;
  banner?: string | null;
  bio?: string | null;
  pronouns?: string | null;
  accent_color?: number | null;
  mention_flags?: number;
}

function validateProfile(edit: UserProfileEdit): void {
  if (!edit || typeof edit !== 'object' || Array.isArray(edit)) throw new TypeError('Micup profile options must be an object');
  const fields = Object.keys(edit);
  if (fields.length === 0) throw new TypeError('Micup profile options must contain at least one field');
  for (const field of fields) if (!profileFields.has(field)) throw new TypeError('Unsupported Micup profile field: ' + field);
  if (edit.username !== undefined && (typeof edit.username !== 'string' || !edit.username.trim() || edit.username.length > 32)) {
    throw new TypeError('A username must be a nonempty string of at most 32 characters');
  }
  for (const field of ['global_name', 'avatar', 'banner', 'bio', 'pronouns'] as const) {
    const value = edit[field];
    if (value !== undefined && value !== null && typeof value !== 'string') throw new TypeError(field + ' must be a string or null');
  }
  for (const field of ['avatar', 'banner'] as const) {
    const value = edit[field];
    if (typeof value === 'string' && value.length === 0) throw new TypeError(field + ' must be a nonempty string or null');
  }
  if (edit.accent_color !== undefined && edit.accent_color !== null &&
      (!Number.isSafeInteger(edit.accent_color) || edit.accent_color < 0)) {
    throw new TypeError('accent_color must be a nonnegative safe integer or null');
  }
  if (edit.mention_flags !== undefined &&
      (!Number.isSafeInteger(edit.mention_flags) || edit.mention_flags < 0)) {
    throw new TypeError('mention_flags must be a nonnegative safe integer');
  }
}

export class MicupUserSession {
  readonly #rest: RestTransport;
  readonly #self: MicupUser;

  private constructor(key: typeof connection, rest: RestTransport, self: MicupUser) {
    if (key !== connection) throw new TypeError('Use MicupUserSession.connect() to create a session');
    this.#rest = rest;
    this.#self = self;
  }

  static async connect(
    { token, origin = defaultOrigin, maxRestAttempts, logger }: MicupUserSessionOptions,
    { signal }: MicupRequestOptions = {},
  ): Promise<MicupUserSession> {
    if (typeof token !== 'string' || !/^[\x21-\x7E]+$/.test(token)) throw new TypeError('A valid Micup user token is required');
    const url = new URL(origin);
    if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
      throw new TypeError('Micup origin must be an HTTPS origin');
    }
    const response = await fetch(new URL('/.well-known/fluxer', url), { redirect: 'error', signal });
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      throw new MicupAPIError(response);
    }
    const discovery = await readLimitedJson(response, maxDiscoveryResponseBytes, 'Micup discovery', signal);
    if (!discovery || typeof discovery !== 'object' || Array.isArray(discovery)) throw new Error('Micup discovery returned an invalid response');
    const endpoints = (discovery as { endpoints?: unknown }).endpoints;
    if (!endpoints || typeof endpoints !== 'object' || Array.isArray(endpoints)) throw new Error('Micup discovery returned an invalid endpoint list');
    const endpoint = (endpoints as { api_public?: unknown }).api_public;
    if (typeof endpoint !== 'string') throw new Error('Micup discovery returned no API endpoint');
    let api: URL;
    try {
      api = new URL(endpoint);
    } catch {
      throw new Error('Micup discovery returned an invalid API endpoint');
    }
    if (api.origin !== url.origin || api.username || api.password || api.search || api.hash) throw new Error('Micup discovery returned an invalid API endpoint');
    const rest = new RestTransport(`${api.href.replace(/\/+$/, '')}/v1`, token, maxRestAttempts, logger, 5, 'user');
    const self = await rest.request<MicupUser>('GET', '/users/@me', { signal });
    if (!self || typeof self.id !== 'string' || !/^\d+$/.test(self.id) || self.bot === true) {
      throw new Error('The credential must belong to a Micup user');
    }
    return new MicupUserSession(connection, rest, self);
  }

  get self(): MicupUser {
    return this.#self;
  }

  editCurrentUser(edit: UserProfileEdit, options?: MicupRequestOptions): Promise<MicupUser> {
    validateProfile(edit);
    return this.#rest.request('PATCH', '/users/@me', { ...options, body: edit });
  }
}
