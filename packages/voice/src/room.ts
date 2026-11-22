import { EventEmitter } from 'node:events';
import type { Room } from '@livekit/rtc-node';
import { withAbort } from './abort.js';
import type { PCMTrack, VoiceTrack, VoiceTrackOptions } from './pcm.js';
import { LiveKitVoiceTrack, type RTC } from './track.js';

export interface VoiceGrant {
  endpoint: string;
  token: string;
  e2ee_key?: string | null;
  p2p?: boolean;
}

export interface VoiceRoomOptions extends VoiceTrackOptions {
  publishOnConnect?: boolean;
}

export interface VoiceRoomEvents {
  memberJoin: [identity: string];
  memberLeave: [identity: string];
  disconnected: [reason: Error];
}

export interface VoiceRoom {
  on<K extends keyof VoiceRoomEvents>(event: K, listener: (...args: VoiceRoomEvents[K]) => void): this;
  once<K extends keyof VoiceRoomEvents>(event: K, listener: (...args: VoiceRoomEvents[K]) => void): this;
  off<K extends keyof VoiceRoomEvents>(event: K, listener: (...args: VoiceRoomEvents[K]) => void): this;
}

export class VoiceRoom extends EventEmitter implements PCMTrack {
  readonly #lifetime = new AbortController();
  readonly #tracks = new Set<VoiceTrack>();
  #closing?: Promise<void>;
  #defaultTrack?: VoiceTrack;

  private constructor(private readonly sdk: RTC, private readonly room: Room, private readonly options: VoiceTrackOptions) {
    super();
    room.on(sdk.RoomEvent.Disconnected, () => {
      const reason = new Error('LiveKit room disconnected');
      const unexpected = !this.#lifetime.signal.aborted;
      this.#lifetime.abort(reason);
      if (unexpected) this.emit('disconnected', reason);
      void this.close().catch(() => {});
    });
    room.on(sdk.RoomEvent.ParticipantConnected, (participant) => this.emit('memberJoin', participant.identity));
    room.on(sdk.RoomEvent.ParticipantDisconnected, (participant) => this.emit('memberLeave', participant.identity));
  }

  static async connect(grant: VoiceGrant, options: VoiceRoomOptions = {}): Promise<VoiceRoom> {
    if (!grant?.endpoint || !grant.token || grant.p2p || grant.e2ee_key) {
      throw new TypeError('A LiveKit grant for unencrypted Micup voice is required');
    }
    const endpoint = new URL(grant.endpoint.includes('://') ? grant.endpoint : 'wss://' + grant.endpoint);
    if (endpoint.username || endpoint.password || endpoint.hash ||
        (endpoint.protocol !== 'wss:' && (endpoint.protocol !== 'ws:' ||
          !['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname)))) {
      throw new TypeError('Invalid LiveKit endpoint');
    }

    const { signal: caller, publishOnConnect = true, ...trackOptions } = options;
    const timeout = AbortSignal.timeout(10_000);
    const signal = caller ? AbortSignal.any([caller, timeout]) : timeout;
    signal.throwIfAborted();
    const sdk = await import('@livekit/rtc-node');
    signal.throwIfAborted();
    const room = new sdk.Room();
    const attempt = room.connect(endpoint.href, grant.token, { autoSubscribe: false, dynacast: false });

    try {
      await withAbort(attempt, signal);
      signal.throwIfAborted();
    } catch {
      const cleanup = attempt.catch(() => {}).then(() => room.disconnect()).catch(() => {});
      if (!signal.aborted) await cleanup;
      signal.throwIfAborted();
      throw new Error('LiveKit audio connection failed');
    }

    const connection = new VoiceRoom(sdk, room, trackOptions);
    try {
      if (publishOnConnect) connection.#defaultTrack = await connection.openTrack({ signal });
      return connection;
    } catch (error) {
      await connection.close().catch(() => {});
      throw error;
    }
  }

  get memberCount(): number {
    return this.room.remoteParticipants?.size ?? 0;
  }

  get connected(): boolean {
    return this.room.isConnected && !this.#lifetime.signal.aborted;
  }

  async openTrack(options: VoiceTrackOptions = {}): Promise<VoiceTrack> {
    const participant = this.room.localParticipant;
    if (!this.connected || !participant) throw new Error('LiveKit room is disconnected');
    const track = await LiveKitVoiceTrack.publish(this.sdk, participant, this.#lifetime.signal, (track) => this.#tracks.delete(track), {
      ...this.options, ...options,
    });
    if (!this.connected) {
      await track.close().catch(() => {});
      throw new Error('LiveKit room is disconnected');
    }
    this.#tracks.add(track);
    return track;
  }

  async write(samples: Int16Array, options?: { signal?: AbortSignal }): Promise<void> {
    if (!this.#defaultTrack) throw new Error('Open a LiveKit audio track before writing PCM');
    await this.#defaultTrack.write(samples, options);
  }

  async drain(options?: { signal?: AbortSignal }): Promise<void> {
    await this.#defaultTrack?.drain(options);
  }

  async clear(): Promise<void> {
    await this.#defaultTrack?.clear();
  }

  close(): Promise<void> {
    return this.#closing ??= this.#close();
  }

  async #close(): Promise<void> {
    this.#lifetime.abort(new Error('LiveKit room was closed'));
    const failures = await Promise.allSettled([...this.#tracks].map((track) => track.close()));
    await this.room.disconnect();
    for (const failure of failures) {
      if (failure.status === 'rejected') throw failure.reason;
    }
  }
}
