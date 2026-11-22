import { setTimeout as delay } from 'node:timers/promises';
import { withAbort } from './abort.js';
import { bytesPerFrame, frameDurationMs, scaleVolume, type PCMTrack } from './pcm.js';

export class PlaybackSkippedError extends Error {
  constructor() {
    super('Micup audio playback was skipped');
    this.name = 'PlaybackSkippedError';
  }
}

export class PlaybackBusyError extends Error {
  constructor() {
    super('Micup audio player is busy');
    this.name = 'PlaybackBusyError';
  }
}

type PCMInput = AsyncIterable<Uint8Array> & { close?(): void | Promise<void> };

export class Player {
  #active?: { controller: AbortController; resume?: () => void; paused?: Promise<void> };
  #volume = 1;

  constructor(private readonly track: PCMTrack) {}

  get playing(): boolean {
    return this.#active !== undefined;
  }

  get paused(): boolean {
    return this.#active?.paused !== undefined;
  }

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

  async play(pcm: PCMInput, { signal }: { signal?: AbortSignal } = {}): Promise<void> {
    if (this.#active) throw new PlaybackBusyError();
    if (!pcm || typeof pcm[Symbol.asyncIterator] !== 'function' ||
        pcm.close !== undefined && typeof pcm.close !== 'function') {
      throw new TypeError('PCM input must be an async iterable with an optional close method');
    }
    const controller = new AbortController();
    signal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    let iterator: AsyncIterator<Uint8Array>;
    try {
      signal.throwIfAborted();
      iterator = pcm[Symbol.asyncIterator]();
    } catch (error) {
      await Promise.resolve().then(() => pcm.close?.()).catch(() => {});
      throw error;
    }
    this.#active = { controller };
    let exhausted = false;
    let used = 0;
    let nextFrameAt = performance.now();
    const frame = Buffer.allocUnsafe(bytesPerFrame);
    const closeSource = () => { void Promise.resolve().then(() => pcm.close?.()).catch(() => {}); };
    signal.addEventListener('abort', closeSource, { once: true });

    const waitWhilePaused = async () => {
      while (this.#active?.paused) {
        await withAbort(this.#active.paused, signal);
        nextFrameAt = performance.now();
      }
      signal.throwIfAborted();
    };

    const write = async (bytes: number) => {
      const remaining = nextFrameAt - performance.now();
      if (remaining > 0) {
        try {
          await delay(Math.ceil(remaining), undefined, { signal });
        } catch (error) {
          signal.throwIfAborted();
          throw error;
        }
      }
      await waitWhilePaused();

      const samples = new Int16Array(bytes / 2);
      for (let i = 0; i < samples.length; i++) samples[i] = frame.readInt16LE(i * 2);
      const now = performance.now();
      nextFrameAt = Math.max(nextFrameAt + frameDurationMs, now + frameDurationMs / 2);
      await withAbort(this.track.write(this.#volume === 1 ? samples : scaleVolume(samples, this.#volume), { signal }), signal);
    };

    try {
      while (!exhausted) {
        await waitWhilePaused();
        const result = await withAbort(iterator.next(), signal);
        exhausted = result.done === true;
        if (exhausted) break;
        const chunk = result.value;
        if (!(chunk instanceof Uint8Array)) throw new TypeError('PCM input must yield Uint8Array chunks');
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
    } catch (error) {
      await Promise.resolve().then(() => this.track.clear?.()).catch(() => {});
      throw error;
    } finally {
      signal.removeEventListener('abort', closeSource);
      this.#active = undefined;
      if (!exhausted) void Promise.resolve().then(() => iterator.return?.()).catch(() => {});
    }
  }
}
