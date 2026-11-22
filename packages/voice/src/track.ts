import type { AudioSource, LocalAudioTrack, LocalParticipant } from '@livekit/rtc-node';
import { withAbort } from './abort.js';
import { channels, sampleRate, samplesPerFrame, type PCMTrack } from './pcm.js';

export type RTC = typeof import('@livekit/rtc-node');

export interface VoiceTrackOptions {
  trackName?: string;
  bitrate?: number;
  signal?: AbortSignal;
}

export class VoiceTrack implements PCMTrack {
  readonly #lifetime = new AbortController();
  #closing?: Promise<void>;
  #capturing?: Promise<void>;

  private constructor(
    private readonly sdk: RTC,
    private readonly source: AudioSource,
    private readonly track: LocalAudioTrack,
    private readonly participant: LocalParticipant,
    private readonly roomSignal: AbortSignal,
    private readonly onClose: (track: VoiceTrack) => void,
  ) {}

  static async publish(
    sdk: RTC, participant: LocalParticipant, roomSignal: AbortSignal, onClose: (track: VoiceTrack) => void,
    { trackName = 'micup.ts', bitrate = 96_000, signal: caller }: VoiceTrackOptions = {},
  ): Promise<VoiceTrack> {
    const signal = caller ? AbortSignal.any([caller, roomSignal]) : roomSignal;
    signal.throwIfAborted();
    if (!Number.isSafeInteger(bitrate) || bitrate < 8000 || bitrate > 512_000) {
      throw new RangeError('LiveKit audio bitrate must be between 8000 and 512000');
    }
    if (typeof trackName !== 'string' || !trackName.trim()) throw new TypeError('A LiveKit track name is required');

    const source = new sdk.AudioSource(sampleRate, channels, 100);
    let track: LocalAudioTrack;
    try {
      track = sdk.LocalAudioTrack.createAudioTrack(trackName, source);
    } catch (error) {
      await source.close().catch(() => {});
      throw error;
    }
    const published = new VoiceTrack(sdk, source, track, participant, roomSignal, onClose);
    const attempt = participant.publishTrack(track, new sdk.TrackPublishOptions({
      source: sdk.TrackSource.SOURCE_MICROPHONE,
      audioEncoding: { maxBitrate: BigInt(bitrate) },
      dtx: false,
    }));
    try {
      await withAbort(attempt, signal);
      signal.throwIfAborted();
      return published;
    } catch (error) {
      const cleanup = attempt.catch(() => {}).then(() => published.close()).catch(() => {});
      if (!signal.aborted) await cleanup;
      throw error;
    }
  }

  get closed(): boolean {
    return this.#lifetime.signal.aborted || this.roomSignal.aborted;
  }

  async write(samples: Int16Array, { signal: caller }: { signal?: AbortSignal } = {}): Promise<void> {
    const signal = this.#signal(caller);
    signal.throwIfAborted();
    if (!(samples instanceof Int16Array) || samples.length < channels ||
        samples.length > samplesPerFrame || samples.length % channels !== 0) {
      throw new RangeError('Audio frames must contain up to 20 ms of stereo PCM');
    }
    if (this.#capturing) throw new Error('A LiveKit audio frame is already being written');

    const frame = new this.sdk.AudioFrame(new Int16Array(samples), sampleRate, channels, samples.length / channels);
    const capture = this.source.captureFrame(frame).finally(() => { this.#capturing = undefined; });
    this.#capturing = capture;
    await withAbort(capture, signal);
  }

  async drain({ signal: caller }: { signal?: AbortSignal } = {}): Promise<void> {
    const signal = this.#signal(caller);
    signal.throwIfAborted();
    await withAbort(this.source.waitForPlayout(), signal);
  }

  async clear(): Promise<void> {
    if (this.closed) return;
    this.source.clearQueue();
    await this.#capturing?.catch(() => {});
    if (!this.closed) this.source.clearQueue();
  }

  close(): Promise<void> {
    return this.#closing ??= this.#close();
  }

  #signal(caller?: AbortSignal): AbortSignal {
    const signals = [this.roomSignal, this.#lifetime.signal];
    if (caller) signals.push(caller);
    return AbortSignal.any(signals);
  }

  async #close(): Promise<void> {
    this.#lifetime.abort(new Error('LiveKit track was closed'));
    try {
      try {
        if (this.track.sid && !this.roomSignal.aborted) {
          await this.participant.unpublishTrack(this.track.sid, false);
        }
      } finally {
        await this.track.close();
      }
    } finally {
      this.onClose(this);
    }
  }
}
