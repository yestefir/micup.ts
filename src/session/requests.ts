import { randomBytes } from 'node:crypto';
import { GatewayOpcode, type GatewayDispatch } from '../gateway/protocol.js';
import type { MicupMember, MicupMembersChunk } from '../model/guild.js';
import { CommandWindow } from '../gateway/window.js';
import { snowflake } from '../rest/messages.js';

export interface GuildCount {
  guild_id: string;
  member_count: number;
  online_count: number;
}

export interface ChannelMemberCount {
  guild_id?: string;
  channel_id: string;
  member_count: number;
  online_count: number;
}

export interface GuildMembersRequest {
  query?: string;
  limit?: number;
  userIds?: readonly string[];
  presences?: boolean;
  signal?: AbortSignal;
}

export class GatewayRequestError extends Error {
  constructor(readonly opcode: number, readonly retryAfter: number) {
    super('Micup rate-limited the Gateway request');
    this.name = 'GatewayRequestError';
  }
}

interface Pending {
  opcode: number;
  name: string;
  accept: (data: unknown) => void;
  reject: (error: unknown) => void;
}

type Send = (opcode: number, data: unknown, options?: { signal?: AbortSignal }) => Promise<void>;

function unique(ids: readonly string[], max: number, label: string): string[] {
  const values = [...new Set(ids.map((id) => snowflake(id, label)))];
  if (!values.length || values.length > max) throw new RangeError(label + ' list accepts 1 to ' + max + ' IDs');
  return values;
}

const fullListInterval = 30_000;

class Slots {
  readonly #waiters = new Set<() => void>();
  #active = 0;

  constructor(private readonly capacity: number) {}

  async acquire(signal: AbortSignal): Promise<() => void> {
    while (this.#active >= this.capacity) {
      signal.throwIfAborted();
      await new Promise<void>((resolve, reject) => {
        const wake = () => {
          signal.removeEventListener('abort', abort);
          this.#waiters.delete(wake);
          resolve();
        };
        const abort = () => {
          this.#waiters.delete(wake);
          reject(signal.reason);
        };
        this.#waiters.add(wake);
        signal.addEventListener('abort', abort, { once: true });
      });
    }
    signal.throwIfAborted();
    this.#active++;
    return () => {
      this.#active--;
      this.#waiters.values().next().value?.();
    };
  }
}

export class SessionRequests {
  readonly #pending = new Map<string, Pending>();
  readonly #members = new Slots(1);
  readonly #counts = new Slots(2);
  readonly #accountMembers = new CommandWindow(10, 10_000);
  readonly #guildMembers = new Map<string, CommandWindow>();
  readonly #fullLists = new Map<string, number>();
  #epoch = new AbortController();

  constructor(private readonly send: Send) {}

  guildCounts(ids: readonly string[], signal?: AbortSignal): Promise<GuildCount[]> {
    return this.#request(GatewayOpcode.RequestGuildCounts, 'GUILD_COUNTS_UPDATE',
      { guild_ids: unique(ids, 100, 'Guild ID') }, this.#counts, signal, (value, resolve) => {
        const counts = (value as { counts?: GuildCount[] }).counts;
        if (Array.isArray(counts)) resolve(counts);
      });
  }

  channelCounts(guildId: string, ids: readonly string[], signal?: AbortSignal): Promise<ChannelMemberCount[]> {
    return this.#request(GatewayOpcode.RequestChannelMemberCounts, 'CHANNEL_MEMBER_COUNTS_UPDATE',
      { guild_id: snowflake(guildId, 'Guild ID'), channel_ids: unique(ids, 25, 'Channel ID') },
      this.#counts, signal, (value, resolve) => {
        const counts = (value as { counts?: ChannelMemberCount[] }).counts;
        if (Array.isArray(counts)) resolve(counts);
      });
  }

  members(guildId: string, { query = '', limit = 0, userIds, presences, signal }: GuildMembersRequest = {}): Promise<MicupMember[]> {
    snowflake(guildId, 'Guild ID');
    if (!Number.isSafeInteger(limit) || limit < 0 || limit > 100 || (userIds?.length && query)) {
      throw new TypeError('Invalid Micup member request');
    }
    const body = {
      guild_id: guildId, query, limit, presences: presences ?? false,
      ...(userIds?.length ? { user_ids: unique(userIds, 100, 'User ID') } : {}),
    };
    const fullList = !query && limit === 0 && !userIds?.length;
    if (fullList) {
      const wait = fullListInterval - (performance.now() - (this.#fullLists.get(guildId) ?? -Infinity));
      if (wait > 0) return Promise.reject(new GatewayRequestError(GatewayOpcode.RequestGuildMembers, Math.ceil(wait / 1000)));
      this.#fullLists.set(guildId, performance.now());
      if (this.#fullLists.size > 1024) this.#fullLists.delete(this.#fullLists.keys().next().value as string);
    }
    const chunks = new Map<number, MicupMember[]>();
    const pace = async (pacing: AbortSignal) => {
      let window = this.#guildMembers.get(guildId);
      if (!window) {
        window = new CommandWindow(35, 10_000);
        this.#guildMembers.set(guildId, window);
        if (this.#guildMembers.size > 1024) this.#guildMembers.delete(this.#guildMembers.keys().next().value as string);
      }
      await this.#accountMembers.acquire(pacing);
      await window.acquire(pacing);
    };
    return this.#request(GatewayOpcode.RequestGuildMembers, 'GUILD_MEMBERS_CHUNK', body, this.#members, signal, (value, resolve, reject) => {
      const chunk = value as MicupMembersChunk;
      if (chunk.guild_id !== guildId) return;
      if (!Number.isSafeInteger(chunk.chunk_count) || chunk.chunk_count < 1 || chunk.chunk_count > 16_384 ||
          !Number.isSafeInteger(chunk.chunk_index) || chunk.chunk_index < 0 || chunk.chunk_index >= chunk.chunk_count ||
          !Array.isArray(chunk.members)) {
        reject(new Error('Micup returned an invalid member chunk'));
        return;
      }
      chunks.set(chunk.chunk_index, chunk.members);
      if (chunks.size === chunk.chunk_count) {
        resolve([...chunks].sort(([a], [b]) => a - b).flatMap(([, members]) => members));
      }
    }, pace);
  }

  receive(event: GatewayDispatch): void {
    const data = event.data as { nonce?: string; meta?: { nonce?: string }; retry_after?: number } | null;
    const nonce = data?.nonce ?? data?.meta?.nonce;
    if (!nonce) return;
    const pending = this.#pending.get(nonce);
    if (!pending) return;
    if (event.name === 'RATE_LIMITED') {
      pending.reject(new GatewayRequestError(pending.opcode, data?.retry_after ?? 0));
    } else if (event.name === pending.name) {
      pending.accept(data);
    }
  }

  invalidate(): void {
    this.#epoch.abort(new Error('Micup Gateway session ended'));
    this.#epoch = new AbortController();
  }

  async #request<T>(
    opcode: number, name: string, body: object, slots: Slots, caller: AbortSignal | undefined,
    accept: (data: unknown, resolve: (value: T) => void, reject: (error: unknown) => void) => void,
    pace?: (signal: AbortSignal) => Promise<void>,
  ): Promise<T> {
    const signals = [this.#epoch.signal, AbortSignal.timeout(12_000)];
    if (caller) signals.push(caller);
    const signal = AbortSignal.any(signals);
    const release = await slots.acquire(signal);
    try {
      await pace?.(signal);
    } catch (error) {
      release();
      throw error;
    }

    const nonce = randomBytes(12).toString('hex');
    let pending!: Pending;
    const result = new Promise<T>((resolve, reject) => {
      pending = { opcode, name, accept: (data) => accept(data, resolve, reject), reject };
    });
    const abort = () => pending.reject(signal.reason);
    this.#pending.set(nonce, pending);
    signal.addEventListener('abort', abort, { once: true });
    try {
      const [, reply] = await Promise.all([this.send(opcode, { ...body, nonce }, { signal }), result]);
      return reply;
    } finally {
      this.#pending.delete(nonce);
      signal.removeEventListener('abort', abort);
      release();
    }
  }
}
