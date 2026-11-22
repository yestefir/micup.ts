import { GatewayOpcode, type GatewayDispatch } from '../gateway/protocol.js';

export interface VoiceServerUpdate {
  guild_id: string;
  channel_id: string;
  connection_id: string;
  endpoint: string;
  token: string;
  p2p?: boolean;
  e2ee_key?: string | null;
}

export interface VoiceJoinOptions {
  selfMute?: boolean;
  selfDeaf?: boolean;
  signal?: AbortSignal;
}

export interface VoiceSessionOptions {
  onVoiceLost?: (guildId: string, connectionId: string) => void;
  onVoiceGrant?: (grant: VoiceServerUpdate) => void;
}

export class VoiceRefusedError extends Error {
  constructor(readonly guildId: string, readonly code: string) {
    super('Micup refused the voice join (' + code + ')');
    this.name = 'VoiceRefusedError';
  }
}

interface PendingJoin {
  channelId: string;
  resolve: (grant: VoiceServerUpdate) => void;
  reject: (error: unknown) => void;
}

interface VoiceState {
  guild_id?: string;
  user_id?: string;
  channel_id?: string | null;
  connection_id?: string;
}

const refusalCodes = new Set(['VOICE_CHANNEL_FULL', 'VOICE_P2P_CONSENT_REQUIRED', 'VOICE_P2P_UNAVAILABLE']);
const validId = (id: string) => typeof id === 'string' && /^\d{1,20}$/.test(id);
type Send = (op: number, data: object, options?: { signal?: AbortSignal }) => Promise<void>;

export class SessionVoice {
  readonly #joins = new Map<string, PendingJoin>();
  readonly #grants = new Map<string, VoiceServerUpdate>();
  #botId?: string;

  constructor(botId: string | undefined, private readonly send: Send, private readonly options: VoiceSessionOptions) {
    this.#botId = botId;
  }

  grant(guildId: string): VoiceServerUpdate | undefined {
    const grant = this.#grants.get(guildId);
    return grant && { ...grant };
  }

  async join(guildId: string, channelId: string, { signal: parent, ...options }: VoiceJoinOptions = {}): Promise<VoiceServerUpdate> {
    if (!validId(guildId) || !validId(channelId)) throw new TypeError('Guild and voice channel IDs must be numeric strings');
    if (this.#joins.has(guildId)) throw new Error('A voice join is already pending for this guild');
    const timeout = AbortSignal.timeout(12_000);
    const signal = parent ? AbortSignal.any([parent, timeout]) : timeout;
    signal.throwIfAborted();

    let join!: PendingJoin;
    const pending = new Promise<VoiceServerUpdate>((resolve, reject) => {
      join = { channelId, resolve, reject };
    });
    const abort = () => join.reject(signal.reason);
    this.#joins.set(guildId, join);
    signal.addEventListener('abort', abort, { once: true });

    try {
      const [, grant] = await Promise.all([
        this.send(GatewayOpcode.VoiceStateUpdate, {
          guild_id: guildId, channel_id: channelId,
          self_mute: options.selfMute ?? false, self_deaf: options.selfDeaf ?? false,
          self_video: false, self_stream: false,
        }, { signal }),
        pending,
      ]);
      signal.throwIfAborted();
      if (this.#joins.get(guildId) !== join) throw new Error('Micup voice join was invalidated');
      this.#grants.set(guildId, grant);
      return { ...grant };
    } finally {
      signal.removeEventListener('abort', abort);
      if (this.#joins.get(guildId) === join) this.#joins.delete(guildId);
    }
  }

  async leave(guildId: string, connectionId: string, signal?: AbortSignal): Promise<void> {
    const grant = this.#grants.get(guildId);
    if (!grant || grant.connection_id !== connectionId) return;
    await this.send(GatewayOpcode.VoiceStateUpdate, {
      guild_id: guildId, channel_id: null, connection_id: connectionId,
    }, { signal });
    if (this.#grants.get(guildId) === grant) this.#grants.delete(guildId);
  }

  async update(guildId: string, options: VoiceJoinOptions): Promise<void> {
    const grant = this.#grants.get(guildId);
    if (!grant) throw new Error('The bot has no Micup voice connection in this guild');
    await this.send(GatewayOpcode.VoiceStateUpdate, {
      guild_id: guildId, channel_id: grant.channel_id, connection_id: grant.connection_id,
      self_mute: options.selfMute ?? false, self_deaf: options.selfDeaf ?? false,
      self_video: false, self_stream: false,
    }, { signal: options.signal });
  }

  receive(event: GatewayDispatch): void {
    if (event.name === 'READY') {
      this.invalidate();
      this.#botId = (event.data as { user?: { id?: string } } | null)?.user?.id ?? this.#botId;
    }
    if (event.name === 'VOICE_SERVER_UPDATE') this.#receiveGrant(event.data as Partial<VoiceServerUpdate> | null);
    if (event.name === 'VOICE_STATE_UPDATE') this.#receiveState(event.data as VoiceState | null);
  }

  refuse(data: unknown): void {
    const code = (data as { code?: string } | null)?.code;
    if (!code || !refusalCodes.has(code)) return;
    const oldest = this.#joins.entries().next();
    if (oldest.done) return;
    const [guildId, pending] = oldest.value;
    pending.reject(new VoiceRefusedError(guildId, code));
  }

  invalidate(): void {
    const joins = [...this.#joins.values()];
    const grants = [...this.#grants.values()];
    this.#joins.clear();
    this.#grants.clear();
    for (const join of joins) join.reject(new Error('Micup Gateway voice session ended'));
    for (const grant of grants) this.options.onVoiceLost?.(grant.guild_id, grant.connection_id);
  }

  #receiveState(state: VoiceState | null): void {
    if (!state?.guild_id || !this.#botId || state.user_id !== this.#botId) return;
    const grant = this.#grants.get(state.guild_id);
    if (grant && state.channel_id !== undefined && state.channel_id !== grant.channel_id) this.#lose(grant);
  }

  #receiveGrant(packet: Partial<VoiceServerUpdate> | null): void {
    if (!packet?.guild_id) return;
    const guildId = packet.guild_id;
    const join = this.#joins.get(guildId);
    const previous = this.#grants.get(guildId);
    const channel = packet.channel_id || join?.channelId || previous?.channel_id;
    if (!packet.endpoint || !packet.token || !packet.connection_id || !channel) {
      join?.reject(new Error('Micup returned an incomplete voice grant'));
      if (previous) this.#lose(previous);
      return;
    }
    const grant: VoiceServerUpdate = {
      guild_id: guildId,
      channel_id: channel,
      connection_id: packet.connection_id,
      endpoint: packet.endpoint,
      token: packet.token,
      p2p: packet.p2p,
      e2ee_key: packet.e2ee_key,
    };
    if (join) {
      if (join.channelId !== channel) join.reject(new Error('Micup granted a different voice channel'));
      else join.resolve(grant);
      return;
    }
    if (!previous) return;
    if (previous.connection_id === grant.connection_id && previous.token === grant.token &&
        previous.endpoint === grant.endpoint && previous.channel_id === grant.channel_id) return;
    if (this.options.onVoiceGrant) {
      this.#grants.set(guildId, grant);
      this.options.onVoiceGrant({ ...grant });
    } else {
      this.#lose(previous);
    }
  }

  #lose(grant: VoiceServerUpdate): void {
    this.#grants.delete(grant.guild_id);
    this.options.onVoiceLost?.(grant.guild_id, grant.connection_id);
  }
}
