import { TypedEmitter } from './emitter.js';
import type { PCMTrack } from './pcm.js';
import { PlaybackSkippedError, Player } from './player.js';
import { VoiceRoom, type VoiceGrant, type VoiceRoomOptions } from './room.js';
import { openSource, type AudioInputStream, type AudioSource } from './source.js';

export type VoiceConnectionStatus = 'connecting' | 'ready' | 'reconnecting' | 'disconnected';

export interface VoiceConnectionGrant extends VoiceGrant {
  guild_id: string;
  channel_id: string;
  connection_id: string;
}

export interface VoiceSessionLike {
  joinVoice(guildId: string, channelId: string, options?: { selfMute?: boolean; selfDeaf?: boolean; signal?: AbortSignal }): Promise<VoiceConnectionGrant>;
  leaveVoice(guildId: string, connectionId: string, options?: { signal?: AbortSignal }): Promise<void>;
}

export interface RoomLike extends PCMTrack {
  readonly connected: boolean;
  readonly memberCount: number;
  close(): Promise<void>;
  on(event: 'memberJoin' | 'memberLeave', listener: (identity: string) => void): unknown;
  on(event: 'disconnected', listener: (reason: Error) => void): unknown;
}

export interface VoiceConnectionOptions extends Omit<VoiceRoomOptions, 'publishOnConnect'> {
  selfMute?: boolean;
  selfDeaf?: boolean;
  volume?: number;
  connectRoom?: (grant: VoiceGrant, options: VoiceRoomOptions) => Promise<RoomLike>;
}

export interface PlayOptions {
  volume?: number;
  seek?: number;
  ffmpeg?: string;
  ffmpegArgs?: readonly string[];
  raw?: boolean;
  signal?: AbortSignal;
}

export interface VoiceConnectionEvents {
  start: [];
  finish: [info: { stopped: boolean }];
  status: [status: VoiceConnectionStatus];
  memberJoin: [identity: string];
  memberLeave: [identity: string];
  disconnect: [reason?: unknown];
  error: [error: Error];
}

type PCMInput = AsyncIterable<Uint8Array> & { close?(): void | Promise<void> };

export class VoiceConnection extends TypedEmitter<VoiceConnectionEvents> {
  readonly #session: VoiceSessionLike;
  readonly #options: VoiceConnectionOptions;
  readonly #player: Player;
  readonly #lifetime = new AbortController();
  #room?: RoomLike;
  #grant: VoiceConnectionGrant;
  #status: VoiceConnectionStatus = 'connecting';
  #current?: Promise<void>;
  #closing?: Promise<void>;

  private constructor(session: VoiceSessionLike, grant: VoiceConnectionGrant, options: VoiceConnectionOptions) {
    super();
    this.#session = session;
    this.#grant = grant;
    this.#options = options;
    const forward: PCMTrack = {
      write: (frame, writeOptions) => this.#activeRoom().write(frame, writeOptions),
      drain: (drainOptions) => this.#room?.drain?.(drainOptions) ?? Promise.resolve(),
      clear: () => this.#room?.clear?.(),
    };
    this.#player = new Player(forward);
    if (options.volume !== undefined) this.#player.setVolume(options.volume);
  }

  static async connect(
    session: VoiceSessionLike, guildId: string, channelId: string, options: VoiceConnectionOptions = {},
  ): Promise<VoiceConnection> {
    const { selfMute, selfDeaf, signal } = options;
    const grant = await session.joinVoice(guildId, channelId, { selfMute, selfDeaf, signal });
    const connection = new VoiceConnection(session, grant, options);
    try {
      await connection.#attach(grant, 'connecting');
    } catch (error) {
      await session.leaveVoice(grant.guild_id, grant.connection_id).catch(() => {});
      connection.#setStatus('disconnected');
      throw error;
    }
    return connection;
  }

  get guildId(): string {
    return this.#grant.guild_id;
  }

  get channelId(): string {
    return this.#grant.channel_id;
  }

  get connectionId(): string {
    return this.#grant.connection_id;
  }

  get status(): VoiceConnectionStatus {
    return this.#status;
  }

  get destroyed(): boolean {
    return this.#status === 'disconnected';
  }

  get memberCount(): number {
    return this.#room?.memberCount ?? 0;
  }

  get playing(): boolean {
    return this.#player.playing;
  }

  get paused(): boolean {
    return this.#player.paused;
  }

  get volume(): number {
    return this.#player.volume;
  }

  setVolume(volume: number): number {
    return this.#player.setVolume(volume);
  }

  pause(): boolean {
    return this.#player.pause();
  }

  resume(): boolean {
    return this.#player.resume();
  }

  stop(): boolean {
    return this.#player.skip();
  }

  async play(input: string | AudioInputStream | PCMInput, options: PlayOptions = {}): Promise<void> {
    if (this.destroyed || this.#status === 'connecting') throw new Error('The voice connection is not ready');
    while (this.#current) {
      this.#player.skip();
      await this.#current.catch(() => {});
    }
    if (options.volume !== undefined) this.#player.setVolume(options.volume);
    const run = this.#run(input, options);
    this.#current = run;
    try {
      await run;
    } finally {
      if (this.#current === run) this.#current = undefined;
    }
  }

  async regrant(grant: VoiceConnectionGrant): Promise<void> {
    if (this.destroyed) throw new Error('The voice connection is closed');
    this.#player.skip();
    await this.#current?.catch(() => {});
    const previous = this.#room;
    this.#room = undefined;
    this.#grant = grant;
    await previous?.close().catch(() => {});
    try {
      await this.#attach(grant, 'reconnecting');
    } catch (error) {
      await this.#finish(error);
      throw error;
    }
  }

  disconnect(): Promise<void> {
    return this.#closing ??= this.#finish();
  }

  async #run(input: string | AudioInputStream | PCMInput, options: PlayOptions): Promise<void> {
    const raw = options.raw === true;
    let source: PCMInput;
    if (raw) {
      if (typeof input === 'string') throw new TypeError('Raw playback needs a PCM stream');
      source = input as PCMInput;
    } else {
      const decoded: AudioSource = openSource(input as string | AudioInputStream, {
        ffmpeg: options.ffmpeg, startSeconds: options.seek, ffmpegArgs: options.ffmpegArgs, signal: options.signal,
      });
      source = decoded;
    }
    this.emit('start');
    try {
      await this.#player.play(source, { signal: options.signal });
      this.emit('finish', { stopped: false });
    } catch (error) {
      if (error instanceof PlaybackSkippedError || options.signal?.aborted || this.#lifetime.signal.aborted) {
        this.emit('finish', { stopped: true });
        return;
      }
      this.#report(error);
      throw error;
    } finally {
      await Promise.resolve(source.close?.()).catch(() => {});
    }
  }

  async #attach(grant: VoiceConnectionGrant, phase: 'connecting' | 'reconnecting'): Promise<void> {
    this.#setStatus(phase);
    const { selfMute, selfDeaf, volume, connectRoom, signal, ...roomOptions } = this.#options;
    const connect = connectRoom ?? ((roomGrant, connectOptions) => VoiceRoom.connect(roomGrant, connectOptions));
    const room = await connect(grant, { ...roomOptions, signal, publishOnConnect: true });
    if (this.#lifetime.signal.aborted) {
      await room.close().catch(() => {});
      throw new Error('The voice connection was closed');
    }
    room.on('memberJoin', (identity) => this.emit('memberJoin', identity));
    room.on('memberLeave', (identity) => this.emit('memberLeave', identity));
    room.on('disconnected', (reason) => {
      if (this.#room === room && !this.#lifetime.signal.aborted) void this.#finish(reason);
    });
    this.#room = room;
    this.#setStatus('ready');
  }

  #activeRoom(): RoomLike {
    if (!this.#room || !this.#room.connected) throw new Error('The voice room is not connected');
    return this.#room;
  }

  async #finish(reason?: unknown): Promise<void> {
    if (this.#lifetime.signal.aborted) return;
    this.#lifetime.abort(reason instanceof Error ? reason : new Error('The voice connection was closed'));
    this.#player.skip();
    await this.#current?.catch(() => {});
    const room = this.#room;
    this.#room = undefined;
    await room?.close().catch(() => {});
    await this.#session.leaveVoice(this.#grant.guild_id, this.#grant.connection_id).catch(() => {});
    this.#setStatus('disconnected');
    this.emit('disconnect', reason);
  }

  #setStatus(status: VoiceConnectionStatus): void {
    if (this.#status === status) return;
    this.#status = status;
    this.emit('status', status);
  }

  #report(error: unknown): void {
    if (this.listenerCount('error') > 0) this.emit('error', error instanceof Error ? error : new Error(String(error)));
  }
}
