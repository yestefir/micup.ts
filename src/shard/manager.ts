import { setTimeout as delay } from 'node:timers/promises';
import { GatewaySession, type ChannelLookup, type GatewaySessionConfig, type GatewaySessionOptions } from '../session/session.js';
import type { CustomStatus, Presence, PresenceStatus } from '../model/presence.js';
import type { MicupMember } from '../model/guild.js';
import type { ChannelMemberCount, GuildCount, GuildMembersRequest } from '../session/requests.js';
import type { VoiceJoinOptions, VoiceServerUpdate } from '../session/voice.js';
import { validateSubscriptions, type GatewaySubscription } from '../gateway/subscription.js';

export interface ShardManagerOptions {
  readonly shardCount: number;
  readonly shardIds?: readonly number[];
  readonly identifyIntervalMs?: number;
  readonly session: GatewaySessionOptions;
}

const maxSnowflake = (1n << 64n) - 1n;

export function shardForGuild(guildId: string, shardCount: number): number {
  if (!Number.isSafeInteger(shardCount) || shardCount < 1) throw new RangeError('Shard count must be positive');
  if (typeof guildId !== 'string' || !/^\d{1,20}$/.test(guildId)) {
    throw new TypeError('Guild ID must be a numeric snowflake');
  }
  const id = BigInt(guildId);
  if (id > maxSnowflake) throw new RangeError('Guild ID exceeds the snowflake range');
  return Number((id >> 22n) % BigInt(shardCount));
}

export class ShardManager {
  readonly #sessions = new Map<number, GatewaySession>();
  readonly shardCount: number;
  readonly #lookup?: ChannelLookup;
  #running = false;

  constructor(config: Pick<GatewaySessionConfig, 'endpoint' | 'token' | 'botId' | 'lookupChannel' | 'lookupMembers'>, options: ShardManagerOptions) {
    const { shardCount, identifyIntervalMs = 5000 } = options;
    if (!Number.isSafeInteger(shardCount) || shardCount < 1) throw new RangeError('Shard count must be positive');
    if (!Number.isSafeInteger(identifyIntervalMs) || identifyIntervalMs < 1 || identifyIntervalMs > 2_147_483_647) {
      throw new RangeError('Invalid shard IDENTIFY interval');
    }
    if (options.shardIds !== undefined && !Array.isArray(options.shardIds)) throw new TypeError('Shard IDs must be an array');
    const ids = options.shardIds === undefined ? Array.from({ length: shardCount }, (_, id) => id) : [...options.shardIds];
    if (!ids.length) throw new RangeError('At least one shard ID is required');
    if (new Set(ids).size !== ids.length) throw new RangeError('Shard IDs must be unique');
    for (const id of ids) {
      if (!Number.isSafeInteger(id) || id < 0 || id >= shardCount) {
        throw new RangeError('Shard IDs must be integers within the shard count');
      }
    }
    this.shardCount = shardCount;
    this.#lookup = config.lookupChannel;
    let nextIdentify = 0;

    const beforeIdentify = async (signal: AbortSignal) => {
      await options.session.beforeIdentify?.(signal);
      while (true) {
        signal.throwIfAborted();
        const now = performance.now();
        if (now >= nextIdentify) {
          nextIdentify = now + identifyIntervalMs;
          return;
        }
        await delay(Math.ceil(nextIdentify - now), undefined, { signal });
      }
    };
    for (const shardId of ids.sort((a, b) => a - b)) {
      this.#sessions.set(shardId, new GatewaySession({ ...config, shardId, shardCount }, {
        ...options.session,
        beforeIdentify,
      }));
    }
  }

  get ready(): boolean {
    return this.shards.every((shard) => shard.ready);
  }

  get shards(): GatewaySession[] {
    return [...this.#sessions.values()];
  }

  shard(id: number): GatewaySession | undefined {
    return this.#sessions.get(id);
  }

  forGuild(guildId: string): GatewaySession {
    const shard = this.shard(shardForGuild(guildId, this.shardCount));
    if (!shard) throw new Error('This shard manager does not own the guild');
    return shard;
  }

  memberInventories(): import('../session/inventory.js').GuildMemberInventory[] {
    return this.shards.flatMap((shard) => shard.memberInventories()).sort((a, b) => a.guildId.localeCompare(b.guildId));
  }

  get guildCount(): number {
    return this.shards.reduce((count, shard) => count + shard.state.guildCount, 0);
  }

  get latency(): number | undefined {
    const measured = this.shards.flatMap((shard) => shard.latency === undefined ? [] : [shard.latency]);
    return measured.length ? measured.reduce((sum, latency) => sum + latency, 0) / measured.length : undefined;
  }

  get presence(): Presence {
    return this.shards[0].presence;
  }

  async updatePresence(presence: Presence, options?: { signal?: AbortSignal }): Promise<void> {
    await Promise.all(this.shards.map((shard) => shard.updatePresence(presence, options)));
  }

  async setStatus(status: PresenceStatus, options?: { signal?: AbortSignal }): Promise<void> {
    await Promise.all(this.shards.map((shard) => shard.setStatus(status, options)));
  }

  async setCustomStatus(status: CustomStatus | null, options?: { signal?: AbortSignal }): Promise<void> {
    await Promise.all(this.shards.map((shard) => shard.setCustomStatus(status, options)));
  }

  async resolveGuild(channelId: string, options?: { signal?: AbortSignal }): Promise<string | undefined> {
    for (const shard of this.shards) {
      const guildId = shard.state.guildForChannel(channelId);
      if (guildId) return guildId;
    }
    if (!this.#lookup) throw new Error('No channel lookup is configured');
    const channel = await this.#lookup(channelId, options);
    if (channel.id !== channelId) throw new Error('Micup returned a different channel');
    if (channel.guild_id) this.shard(shardForGuild(channel.guild_id, this.shardCount))?.state.rememberChannel(channel);
    return channel.guild_id;
  }

  joinVoice(guildId: string, channelId: string, options?: VoiceJoinOptions): Promise<VoiceServerUpdate> {
    return this.forGuild(guildId).joinVoice(guildId, channelId, options);
  }

  leaveVoice(guildId: string, connectionId: string, options?: { signal?: AbortSignal }): Promise<void> {
    return this.forGuild(guildId).leaveVoice(guildId, connectionId, options);
  }

  voice(guildId: string): VoiceServerUpdate | undefined {
    return this.forGuild(guildId).voice(guildId);
  }

  updateVoiceState(guildId: string, options: VoiceJoinOptions): Promise<void> {
    return this.forGuild(guildId).updateVoiceState(guildId, options);
  }

  requestGuildMembers(guildId: string, options?: GuildMembersRequest): Promise<MicupMember[]> {
    return this.forGuild(guildId).requestGuildMembers(guildId, options);
  }

  requestChannelMemberCounts(guildId: string, channelIds: readonly string[], options?: { signal?: AbortSignal }): Promise<ChannelMemberCount[]> {
    return this.forGuild(guildId).requestChannelMemberCounts(guildId, channelIds, options);
  }

  async requestGuildCounts(guildIds: readonly string[], options?: { signal?: AbortSignal }): Promise<GuildCount[]> {
    if (!guildIds.length) throw new TypeError('At least one guild ID is required');
    const groups = this.#groupGuilds([...new Set(guildIds)]);
    const work: Promise<GuildCount[]>[] = [];
    for (const [shard, ids] of groups) {
      for (let index = 0; index < ids.length; index += 100) {
        work.push(shard.requestGuildCounts(ids.slice(index, index + 100), options));
      }
    }
    return (await Promise.all(work)).flat();
  }

  async subscribe(subscriptions: Readonly<Record<string, GatewaySubscription>>, options?: { signal?: AbortSignal }): Promise<void> {
    validateSubscriptions(subscriptions);
    const groups = this.#groupGuilds(Object.keys(subscriptions));
    await Promise.all([...groups].map(([shard, ids]) =>
      shard.subscribe(Object.fromEntries(ids.map((id) => [id, subscriptions[id]])), options)));
  }

  #groupGuilds(guildIds: readonly string[]): Map<GatewaySession, string[]> {
    const groups = new Map<GatewaySession, string[]>();
    for (const guildId of guildIds) {
      const shard = this.forGuild(guildId);
      const ids = groups.get(shard);
      if (ids) ids.push(guildId);
      else groups.set(shard, [guildId]);
    }
    return groups;
  }

  async run({ signal }: { signal?: AbortSignal } = {}): Promise<void> {
    if (this.#running) throw new Error('Micup shard manager is already running');
    this.#running = true;
    const stop = new AbortController();
    const combined = signal ? AbortSignal.any([stop.signal, signal]) : stop.signal;

    try {
      const results = await Promise.allSettled(this.shards.map(async (shard) => {
        try {
          await shard.run({ signal: combined });
        } catch (cause) {
          const error = new Error('Micup shard ' + shard.shardId + ' stopped', { cause });
          stop.abort(error);
          throw error;
        }
      }));
      if (stop.signal.aborted) throw stop.signal.reason;
      for (const result of results) {
        if (result.status === 'rejected') throw result.reason;
      }
    } finally {
      this.#running = false;
    }
  }
}
