import { setTimeout as delay } from 'node:timers/promises';

export class CommandWindow {
  readonly #timestamps: number[] = [];

  constructor(private readonly capacity: number, private readonly duration: number) {}

  async acquire(signal: AbortSignal): Promise<void> {
    while (true) {
      signal.throwIfAborted();
      const now = performance.now();
      while (this.#timestamps[0] <= now - this.duration) {
        this.#timestamps.shift();
      }
      if (this.#timestamps.length < this.capacity) {
        this.#timestamps.push(now);
        return;
      }
      try {
        await delay(Math.ceil(this.#timestamps[0] + this.duration - now), undefined, { signal });
      } catch (error) {
        signal.throwIfAborted();
        throw error;
      }
    }
  }
}
