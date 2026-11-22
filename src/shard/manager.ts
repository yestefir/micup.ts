import { setTimeout as delay } from 'node:timers/promises';
import { GatewaySession, type GatewaySessionConfig, type GatewaySessionOptions } from '../session/session.js';

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
  #running = false;

  constructor(config: Pick<GatewaySessionConfig, 'endpoint' | 'token' | 'botId'>, options: ShardManagerOptions) {
    const { shardCount, identifyIntervalMs = 5000 } = options;
    if (!Number.isSafeInteger(shardCount) || shardCount < 1) throw new RangeError('Shard count must be positive');
    if (!Number.isSafeInteger(identifyIntervalMs) || identifyIntervalMs < 1 || identifyIntervalMs > 2_147_483_647) {
      throw new RangeError('Invalid shard IDENTIFY interval');
    }
    const ids = options.shardIds?.length ? [...options.shardIds] : Array.from({ length: shardCount }, (_, id) => id);
    if (new Set(ids).size !== ids.length) throw new RangeError('Shard IDs must be unique');
    this.shardCount = shardCount;
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
