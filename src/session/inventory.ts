import { setTimeout as delay } from 'node:timers/promises';
import type { GatewayDispatch } from '../gateway/protocol.js';
import type { MicupUser } from '../model/entities.js';
import type { MicupGuildCreate, MicupMember, MicupVoiceState } from '../model/guild.js';
import { compareSnowflakes } from '../model/format.js';

export type MemberPageLookup = (
  guildId: string, options: { limit: number; after?: string; signal: AbortSignal },
) => Promise<readonly MicupMember[]>;

export interface GuildMemberInventory {
  guildId: string;
  members: Map<string, boolean>;
  complete: boolean;
  available: boolean;
}

interface InventoryEntry {
  members: Map<string, boolean>;
  changes?: Map<string, boolean | undefined>;
  complete: boolean;
  available: boolean;
  retryAt: number;
}

const pageSize = 1000;

function abortable<T>(signal: AbortSignal, work: Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    void work.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    if (signal.aborted) {
      signal.removeEventListener('abort', abort);
      abort();
    }
  });
}

export class MemberInventory {
  readonly #guilds = new Map<string, InventoryEntry>();

  constructor(private readonly page: MemberPageLookup) {}

  clear(): void {
    this.#guilds.clear();
  }

  snapshots(): GuildMemberInventory[] {
    return [...this.#guilds].sort(([a], [b]) => a.localeCompare(b)).map(([guildId, entry]) => ({
      guildId, complete: entry.complete, available: entry.available, members: new Map(entry.members),
    }));
  }

  observe(event: GatewayDispatch): void {
    const { name, data } = event;
    if (!data || typeof data !== 'object') return;
    switch (name) {
      case 'READY':
        this.clear();
        for (const guild of (data as { guilds?: MicupGuildCreate[] }).guilds ?? []) this.#guild(guild);
        break;
      case 'GUILD_CREATE':
      case 'GUILD_SYNC':
        this.#guild(data as MicupGuildCreate);
        break;
      case 'GUILD_DELETE': {
        const guild = data as { id: string; unavailable?: boolean };
        if (guild.unavailable) {
          const entry = this.#guilds.get(guild.id);
          if (entry) entry.available = false;
        } else this.#guilds.delete(guild.id);
        break;
      }
      case 'GUILD_MEMBER_ADD':
      case 'GUILD_MEMBER_UPDATE':
      case 'GUILD_MEMBER_REMOVE': {
        const { guild_id, user } = data as { guild_id: string; user?: MicupUser };
        if (user?.id) this.#write(guild_id, user, name === 'GUILD_MEMBER_REMOVE');
        break;
      }
      case 'VOICE_STATE_UPDATE': {
        const { guild_id, member } = data as MicupVoiceState;
        if (guild_id && member?.user) this.#write(guild_id, member.user);
        break;
      }
    }
  }

  async run(ready: () => boolean, signal: AbortSignal): Promise<void> {
    try {
      while (!signal.aborted) {
        await delay(1000, undefined, { signal, ref: false });
        while (!signal.aborted && ready()) {
          const current = [...this.#guilds].find(([, entry]) => entry.available && !entry.complete && performance.now() >= entry.retryAt);
          if (!current) break;
          await this.#sync(current[0], current[1], AbortSignal.any([signal, AbortSignal.timeout(30_000)]));
        }
      }
    } catch (error) {
      if (!signal.aborted) throw error;
    }
  }

  #guild(guild: MicupGuildCreate): void {
    if (!guild?.id) return;
    const existing = this.#guilds.get(guild.id);
    if (guild.unavailable && existing) {
      existing.available = false;
      return;
    }
    const entry: InventoryEntry = {
      available: !guild.unavailable, complete: false, members: new Map(), retryAt: 0,
    };
    this.#guilds.set(guild.id, entry);
    for (const member of guild.members ?? []) {
      if (member.user) this.#write(guild.id, member.user);
    }
    for (const voice of guild.voice_states ?? []) {
      if (voice.member?.user) this.#write(guild.id, voice.member.user);
    }
  }

  #write(guildId: string, user: MicupUser, removed = false): void {
    const entry = this.#guilds.get(guildId);
    if (!entry || !user.id) return;
    const bot = removed ? undefined : Boolean(user.bot);
    if (bot === undefined) entry.members.delete(user.id);
    else entry.members.set(user.id, bot);
    entry.changes?.set(user.id, bot);
  }

  async #sync(guildId: string, entry: InventoryEntry, signal: AbortSignal): Promise<void> {
    const members = new Map<string, boolean>();
    entry.changes = new Map();
    let cursor: string | undefined;
    try {
      while (this.#guilds.get(guildId) === entry && entry.available) {
        signal.throwIfAborted();
        const page = await abortable(signal, this.page(guildId, { limit: pageSize, after: cursor, signal }));
        signal.throwIfAborted();
        for (const member of page) {
          if (!member.user?.id) throw new Error('Micup returned an invalid inventory member');
          members.set(member.user.id, Boolean(member.user.bot));
        }
        if (page.length < pageSize) {
          if (this.#guilds.get(guildId) !== entry || !entry.available) return;
          for (const [id, bot] of entry.changes) {
            if (bot === undefined) members.delete(id);
            else members.set(id, bot);
          }
          entry.members = members;
          entry.complete = true;
          return;
        }
        const next = page.at(-1)?.user?.id;
        if (!next || cursor !== undefined && compareSnowflakes(next, cursor) <= 0) throw new Error('Micup member pagination did not advance');
        cursor = next;
      }
    } catch {
      entry.retryAt = performance.now() + 10_000;
    } finally {
      entry.changes = undefined;
    }
  }
}
