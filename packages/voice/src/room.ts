import type { AudioSource, LocalAudioTrack, Room } from '@livekit/rtc-node';
import { withAbort } from './abort.js';
import { channels, sampleRate, samplesPerFrame, type PCMTrack } from './pcm.js';

export interface VoiceGrant {
  endpoint: string;
  token: string;
  e2ee_key?: string | null;
  p2p?: boolean;
}

export interface VoiceRoomOptions {
  trackName?: string;
  bitrate?: number;
  signal?: AbortSignal;
}

type RTC = typeof import('@livekit/rtc-node');

export class VoiceRoom implements PCMTrack {
  readonly #lifetime = new AbortController();
  #closing?: Promise<void>;
  #writing = false;

  private constructor(
    private readonly sdk: RTC,
    private readonly room: Room,
    private readonly source: AudioSource,
    private readonly track: LocalAudioTrack,
  ) {
    room.on(sdk.RoomEvent.Disconnected, () => this.#lifetime.abort(new Error('LiveKit room disconnected')));
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
    const { trackName = 'micup.ts', bitrate = 96_000, signal: parent } = options;
    if (!Number.isSafeInteger(bitrate) || bitrate < 8000 || bitrate > 512_000) {
      throw new RangeError('LiveKit audio bitrate must be between 8000 and 512000');
    }
    const timeout = AbortSignal.timeout(10_000);
    const signal = parent ? AbortSignal.any([parent, timeout]) : timeout;
    signal.throwIfAborted();
    const sdk = await import('@livekit/rtc-node');
    signal.throwIfAborted();
    const room = new sdk.Room();
    let source: AudioSource | undefined;
    let track: LocalAudioTrack | undefined;
    const connect = async () => {
      await room.connect(endpoint.href, grant.token, { autoSubscribe: false, dynacast: false });
      signal.throwIfAborted();
      if (!room.localParticipant) throw new Error('No LiveKit participant was created');
      source = new sdk.AudioSource(sampleRate, channels, 100);
      track = sdk.LocalAudioTrack.createAudioTrack(trackName, source);
      await room.localParticipant.publishTrack(track, new sdk.TrackPublishOptions({
        source: sdk.TrackSource.SOURCE_MICROPHONE,
        audioEncoding: { maxBitrate: BigInt(bitrate) },
        dtx: false,
      }));
      signal.throwIfAborted();
      return new VoiceRoom(sdk, room, source, track);
    };
    const attempt = connect();

    try {
      return await withAbort(attempt, signal);
    } catch {
      const cleanup = attempt.then(async (connected) => connected.close(), async () => {
        await room.disconnect().catch(() => {});
        if (track) await track.close().catch(() => {});
        else await source?.close().catch(() => {});
      });
      if (!signal.aborted) await cleanup;
      else void cleanup.catch(() => {});
      signal.throwIfAborted();
      throw new Error('LiveKit audio connection failed');
    }
  }

  get connected(): boolean {
    return this.room.isConnected && !this.#lifetime.signal.aborted;
  }

  async write(samples: Int16Array, { signal: caller }: { signal?: AbortSignal } = {}): Promise<void> {
    if (!this.connected) throw new Error('LiveKit room is disconnected');
    if (!(samples instanceof Int16Array) || samples.length < channels ||
        samples.length > samplesPerFrame || samples.length % channels !== 0) {
      throw new RangeError('Audio frames must contain up to 20 ms of stereo PCM');
    }
    if (this.#writing) throw new Error('A LiveKit audio frame is already being written');
    const signal = this.#signal(caller);
    signal.throwIfAborted();
    this.#writing = true;
    const frame = new this.sdk.AudioFrame(new Int16Array(samples), sampleRate, channels, samples.length / channels);
    const capture = this.source.captureFrame(frame).finally(() => { this.#writing = false; });
    await withAbort(capture, signal);
  }

  async drain({ signal: caller }: { signal?: AbortSignal } = {}): Promise<void> {
    const signal = this.#signal(caller);
    signal.throwIfAborted();
    await withAbort(this.source.waitForPlayout(), signal);
  }

  close(): Promise<void> {
    return this.#closing ??= this.#close();
  }

  #signal(caller?: AbortSignal): AbortSignal {
    return caller ? AbortSignal.any([caller, this.#lifetime.signal]) : this.#lifetime.signal;
  }

  async #close(): Promise<void> {
    this.#lifetime.abort(new Error('LiveKit room was closed'));
    try {
      if (this.track.sid && this.room.localParticipant) {
        await this.room.localParticipant.unpublishTrack(this.track.sid, false);
      }
    } finally {
      try {
        await this.track.close();
      } finally {
        await this.room.disconnect();
      }
    }
  }
}
