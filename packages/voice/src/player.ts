import { setTimeout as delay } from 'node:timers/promises';
import { withAbort } from './abort.js';
import { bytesPerFrame, frameDurationMs, scaleVolume, type PCMTrack } from './pcm.js';

export class PlaybackSkippedError extends Error {
  constructor() {
    super('Micup audio playback was skipped');
    this.name = 'PlaybackSkippedError';
  }
}

export class Player {
  #active?: { controller: AbortController; resume?: () => void; paused?: Promise<void> };
  #volume = 1;

  constructor(private readonly track: PCMTrack) {}

  get volume(): number {
    return this.#volume;
  }

  setVolume(value: number): number {
    if (!Number.isFinite(value)) throw new RangeError('Volume must be finite');
    this.#volume = Math.min(2, Math.max(0, value));
    return this.#volume;
  }

  pause(): boolean {
    const active = this.#active;
    if (!active || active.paused) return false;
    active.paused = new Promise((resolve) => { active.resume = resolve; });
    return true;
  }

  resume(): boolean {
    const active = this.#active;
    if (!active?.paused) return false;
    active.paused = undefined;
    active.resume?.();
    active.resume = undefined;
    return true;
  }

  skip(): boolean {
    if (!this.#active || this.#active.controller.signal.aborted) return false;
    this.#active.controller.abort(new PlaybackSkippedError());
    return true;
  }

  async play(pcm: AsyncIterable<Uint8Array>, { signal }: { signal?: AbortSignal } = {}): Promise<void> {
    if (this.#active) throw new Error('Micup audio player is busy');
    const controller = new AbortController();
    signal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    signal.throwIfAborted();
    const iterator = pcm[Symbol.asyncIterator]();
    this.#active = { controller };
    let exhausted = false;
    let used = 0;
    let nextFrameAt = performance.now();
    const frame = Buffer.allocUnsafe(bytesPerFrame);

    const write = async (bytes: number) => {
      const remaining = nextFrameAt - performance.now();
      if (remaining > 0) await delay(Math.ceil(remaining), undefined, { signal });
      while (this.#active?.paused) await withAbort(this.#active.paused, signal);
      signal.throwIfAborted();

      const samples = new Int16Array(bytes / 2);
      for (let i = 0; i < samples.length; i++) samples[i] = frame.readInt16LE(i * 2);
      nextFrameAt = performance.now() + frameDurationMs;
      await withAbort(this.track.write(this.#volume === 1 ? samples : scaleVolume(samples, this.#volume), { signal }), signal);
    };

    try {
      while (!exhausted) {
        signal.throwIfAborted();
        const result = await withAbort(iterator.next(), signal);
        exhausted = result.done === true;
        if (exhausted) break;
        const chunk = result.value;
        for (let index = 0; index < chunk.length;) {
          const size = Math.min(frame.length - used, chunk.length - index);
          frame.set(chunk.subarray(index, index + size), used);
          index += size;
          used += size;
          if (used === frame.length) {
            await write(used);
            used = 0;
          }
        }
      }
      if (used % 4 !== 0) throw new Error('Micup PCM input ended in a partial stereo sample');
      if (used) await write(used);
      const drain = this.track.drain?.({ signal });
      if (drain) await withAbort(drain, signal);
    } finally {
      this.#active = undefined;
      if (!exhausted) void Promise.resolve().then(() => iterator.return?.()).catch(() => {});
    }
  }
}
