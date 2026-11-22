type Listener = (...args: any[]) => unknown;

export class TypedEmitter<Events extends { [K in keyof Events]: unknown[] }> {
  readonly #listeners = new Map<keyof Events, Map<Listener, Listener>>();

  on<K extends keyof Events>(event: K, listener: (...args: Events[K]) => unknown): this {
    return this.#add(event, listener, listener);
  }

  once<K extends keyof Events>(event: K, listener: (...args: Events[K]) => unknown): this {
    const wrapper = (...args: Events[K]) => {
      this.off(event, listener);
      return listener(...args);
    };
    return this.#add(event, listener, wrapper);
  }

  off<K extends keyof Events>(event: K, listener: (...args: Events[K]) => unknown): this {
    const entries = this.#listeners.get(event);
    entries?.delete(listener as Listener);
    if (entries && !entries.size) this.#listeners.delete(event);
    return this;
  }

  emit<K extends keyof Events>(event: K, ...args: Events[K]): boolean {
    const entries = this.#listeners.get(event);
    if (!entries?.size) return false;
    for (const wrapper of [...entries.values()]) {
      try {
        const result = (wrapper as (...values: Events[K]) => unknown)(...args);
        if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
          void Promise.resolve(result).catch((error) => this.#reportListenerError(error, event));
        }
      } catch (error) {
        this.#reportListenerError(error, event);
      }
    }
    return true;
  }

  listenerCount(event: keyof Events): number {
    return this.#listeners.get(event)?.size ?? 0;
  }

  removeAllListeners(event?: keyof Events): this {
    if (event === undefined) this.#listeners.clear();
    else this.#listeners.delete(event);
    return this;
  }

  #add<K extends keyof Events>(event: K, key: (...args: Events[K]) => unknown, wrapper: (...args: Events[K]) => unknown): this {
    let entries = this.#listeners.get(event);
    if (!entries) {
      entries = new Map();
      this.#listeners.set(event, entries);
    }
    entries.set(key as Listener, wrapper as Listener);
    return this;
  }

  #reportListenerError(error: unknown, event: keyof Events): void {
    if (event === 'error') {
      console.error('[micup.ts/voice] an error listener failed', error);
      return;
    }
    const handlers = this.#listeners.get('error' as keyof Events);
    if (!handlers?.size) return;
    const failure = error instanceof Error ? error : new Error(String(error));
    for (const handler of [...handlers.values()]) {
      try {
        const result = handler(failure);
        if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
          void Promise.resolve(result).catch((cause) => console.error('[micup.ts/voice] an error listener failed', cause));
        }
      } catch (cause) {
        console.error('[micup.ts/voice] an error listener failed', cause);
      }
    }
  }
}
