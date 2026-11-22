import { setTimeout as delay } from 'node:timers/promises';

export class CommandWindow {
  readonly #timestamps: number[] = [];

  constructor(private readonly capacity: number, private readonly duration: number) {
    if (!Number.isSafeInteger(capacity) || capacity < 1) throw new RangeError('Command window capacity must be a positive integer');
    if (!Number.isFinite(duration) || duration < 1) throw new RangeError('Command window duration must be at least 1 millisecond');
  }

  async acquire(signal: AbortSignal): Promise<void> {
    while (true) {
      signal.throwIfAborted();
      const now = performance.now();
      const oldest = this.#timestamps[0];
      if (oldest !== undefined && oldest <= now - this.duration) {
        this.#timestamps.shift();
        continue;
      }
      if (this.#timestamps.length < this.capacity) {
        this.#timestamps.push(now);
        return;
      }
      try {
        if (oldest === undefined) continue;
        await delay(Math.ceil(oldest + this.duration - now), undefined, { signal });
      } catch (error) {
        signal.throwIfAborted();
        throw error;
      }
    }
  }
}
