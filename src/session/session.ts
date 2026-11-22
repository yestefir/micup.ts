import { setTimeout as delay } from 'node:timers/promises';
import { GatewayConnection, type GatewayResume } from '../gateway/connection.js';
import { GatewayCloseError, gatewayEndpoint, type GatewayDispatch } from '../gateway/protocol.js';

import { SessionVoice, type VoiceJoinOptions, type VoiceServerUpdate, type VoiceSessionOptions } from './voice.js';

import { Permission, hasPermissions } from '../model/permissions.js';
import { GatewayState } from '../state/cache.js';

import { GatewayOpcode } from '../gateway/protocol.js';
import type { MicupMember } from '../model/guild.js';
import { activePresence, normalizePresence, type CustomStatus, type Presence, type PresenceStatus } from '../model/presence.js';
import { SessionRequests, type ChannelMemberCount, type GuildCount, type GuildMembersRequest } from './requests.js';

export interface GatewaySessionConfig {
  readonly endpoint: string;
  readonly token: string;
  readonly botId?: string;
  readonly shardId?: number;
  readonly shardCount?: number;
}

export interface GatewaySessionOptions extends VoiceSessionOptions {
  readonly handler: (event: GatewayDispatch, signal: AbortSignal) => void | Promise<void>;
  readonly ignoredEvents?: readonly string[];
  readonly flags?: number;
  readonly presence?: Presence;
  readonly minBackoffMs?: number;
  readonly maxBackoffMs?: number;
  readonly onReady?: (resumed: boolean) => void;
  readonly onDisconnect?: (error: unknown) => void;
  readonly onGatewayError?: (data: unknown) => void;
  readonly beforeIdentify?: (signal: AbortSignal) => Promise<void>;
}

export class GatewaySession {
  readonly #resume: GatewayResume = { sequence: null };
  readonly #endpoint: URL;
  readonly #token: string;
  readonly #shard: [number, number];
  readonly #options: Readonly<GatewaySessionOptions>;
  readonly #ignoredEvents: string[];
  readonly #flags: number;
  readonly #voice: SessionVoice;
  readonly state = new GatewayState();
  #botId?: string;
  #presence?: Presence;
  readonly #requests: SessionRequests;
  readonly #minBackoff: number;
  readonly #maxBackoff: number;
  #running = false;
  #ready = false;
  #connection?: GatewayConnection;

  constructor(config: GatewaySessionConfig, options: GatewaySessionOptions) {
    this.#endpoint = gatewayEndpoint(config.endpoint);
    if (!/^[\x21-\x7E]+$/.test(config.token ?? '')) throw new TypeError('Gateway token is required');
    this.#token = config.token;
    this.#botId = config.botId;
    const id = config.shardId ?? 0;
    const count = config.shardCount ?? 1;
    if (!Number.isSafeInteger(id) || !Number.isSafeInteger(count) || id < 0 || id >= count) {
      throw new RangeError('Invalid Micup shard configuration');
    }
    this.#shard = [id, count];
    if (typeof options?.handler !== 'function') throw new TypeError('A Gateway event handler is required');
    this.#options = { ...options };
    this.#voice = new SessionVoice(config.botId, this.send.bind(this), this.#options);
    this.#requests = new SessionRequests(this.send.bind(this));
    this.#presence = options.presence && normalizePresence(options.presence);
    this.#ignoredEvents = [...(options.ignoredEvents ?? [])];
    if (this.#ignoredEvents.length > 256 || this.#ignoredEvents.some((name) => !/^[A-Z][A-Z_0-9]*$/.test(name))) {
      throw new TypeError('Invalid Micup ignored Gateway events');
    }
    this.#flags = options.flags ?? 0;
    if (!Number.isSafeInteger(this.#flags) || this.#flags < 0) throw new RangeError('Invalid Micup session flags');
    this.#minBackoff = options.minBackoffMs ?? 1000;
    this.#maxBackoff = options.maxBackoffMs ?? 15_000;
    if (!Number.isSafeInteger(this.#minBackoff) || !Number.isSafeInteger(this.#maxBackoff) ||
        this.#minBackoff < 1 || this.#maxBackoff < this.#minBackoff || this.#maxBackoff > 2_147_483_647) {
      throw new RangeError('Invalid Micup reconnect backoff');
    }
  }

  get ready(): boolean {
    return this.#ready;
  }

  get shardId(): number {
    return this.#shard[0];
  }

  get sessionId(): string | undefined {
    return this.#resume.sessionId;
  }

  get latency(): number | undefined {
    return this.#connection?.latency;
  }

  async send(opcode: number, data: unknown, { signal }: { signal?: AbortSignal } = {}): Promise<void> {
    if (!this.#ready || !this.#connection) throw new Error('Micup Gateway is disconnected');
    await this.#connection.send(opcode, data, signal);
  }

  get presence(): Presence {
    return structuredClone(activePresence(this.#presence ?? { status: 'online', custom_status: null }));
  }

  async updatePresence(presence: Presence, { signal }: { signal?: AbortSignal } = {}): Promise<void> {
    signal?.throwIfAborted();
    this.#presence = normalizePresence(presence);
    if (this.ready) await this.send(GatewayOpcode.PresenceUpdate, this.#presence, { signal });
  }

  setStatus(status: PresenceStatus, options?: { signal?: AbortSignal }): Promise<void> {
    return this.updatePresence({ ...this.presence, status }, options);
  }

  setCustomStatus(custom_status: CustomStatus | null, options?: { signal?: AbortSignal }): Promise<void> {
    return this.updatePresence({ ...this.presence, custom_status }, options);
  }

  requestGuildCounts(ids: readonly string[], { signal }: { signal?: AbortSignal } = {}): Promise<GuildCount[]> {
    return this.#requests.guildCounts(ids, signal);
  }

  requestChannelMemberCounts(guildId: string, ids: readonly string[], { signal }: { signal?: AbortSignal } = {}): Promise<ChannelMemberCount[]> {
    return this.#requests.channelCounts(guildId, ids, signal);
  }

  requestGuildMembers(guildId: string, request?: GuildMembersRequest): Promise<MicupMember[]> {
    return this.#requests.members(guildId, request);
  }

  async joinVoice(guildId: string, channelId: string, options?: VoiceJoinOptions): Promise<VoiceServerUpdate> {
    const permission = this.#botId && this.state.permissions(guildId, this.#botId, channelId);
    if (typeof permission === 'bigint' && !hasPermissions(permission, Permission.ViewChannel | Permission.Connect)) {
      throw new Error('The bot needs View Channel and Connect permissions for this voice channel');
    }
    return this.#voice.join(guildId, channelId, options);
  }

  voice(guildId: string): VoiceServerUpdate | undefined {
    return this.#voice.grant(guildId);
  }

  leaveVoice(guildId: string, connectionId: string, { signal }: { signal?: AbortSignal } = {}): Promise<void> {
    return this.#voice.leave(guildId, connectionId, signal);
  }

  updateVoiceState(guildId: string, options: VoiceJoinOptions): Promise<void> {
    return this.#voice.update(guildId, options);
  }

  async run({ signal = new AbortController().signal }: { signal?: AbortSignal } = {}): Promise<void> {
    if (this.#running) throw new Error('Micup Gateway session is already running');
    this.#running = true;
    let backoff = this.#minBackoff;
    try {
      while (!signal.aborted) {
        try {
          await GatewayConnection.run({
            endpoint: this.#endpoint,
            token: this.#token,
            shard: this.#shard,
            flags: this.#flags,
            presence: () => this.#presence && activePresence(this.#presence),
            ignoredEvents: this.#ignoredEvents,
            resume: this.#resume,
            beforeIdentify: this.#options.beforeIdentify,
            dispatch: async (event, lifetime) => {
              if (event.name === 'READY') {
                this.#botId = (event.data as { user?: { id?: string } } | null)?.user?.id ?? this.#botId;
              }
              this.state.apply(event);
              await this.#options.handler(event, lifetime);
            },
            receive: (event) => {
              this.#voice.receive(event);
              this.#requests.receive(event);
            },
            onGatewayError: (data) => {
              this.#voice.refuse(data);
              this.#options.onGatewayError?.(data);
            },
            onInvalidate: () => {
              this.#ready = false;
              this.#voice.invalidate();
              this.#requests.invalidate();
              this.state.clear();
            },
            onReady: (resumed) => {
              this.#ready = true;
              backoff = this.#minBackoff;
              this.#options.onReady?.(resumed);
            },
          }, signal, (connection) => { this.#connection = connection; });
        } catch (error) {
          this.#ready = false;
          this.#connection = undefined;
          if (signal.aborted) return;
          if (error instanceof GatewayCloseError && error.resetsSession) {
            this.#voice.invalidate();
            this.#requests.invalidate();
            this.state.clear();
            this.#resume.sessionId = undefined;
            this.#resume.sequence = null;
          }
          this.#options.onDisconnect?.(error);
          if (error instanceof GatewayCloseError && error.fatal) throw error;
          await delay(backoff, undefined, { signal }).catch((cause) => {
            if (!signal.aborted) throw cause;
          });
          backoff = Math.min(this.#maxBackoff, backoff * 2);
        }
      }
    } finally {
      this.#ready = false;
      this.#connection = undefined;
      this.#running = false;
      this.#requests.invalidate();
      this.#voice.invalidate();
    }
  }
}
