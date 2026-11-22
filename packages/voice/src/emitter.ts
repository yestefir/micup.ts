type Listener = (...args: unknown[]) => unknown;

interface Entry {
  key: unknown;
  wrapper: Listener;
}

export class TypedEmitter<Events extends { [K in keyof Events]: unknown[] }> {
  readonly #listeners = new Map<keyof Events, Entry[]>();

  on<K extends keyof Events>(event: K, listener: (...args: Events[K]) => unknown): this {
    this.#add(event, listener, (...args) => listener(...args as Events[K]));
    return this;
  }

  once<K extends keyof Events>(event: K, listener: (...args: Events[K]) => unknown): this {
    let remove!: () => void;
    const wrapper = (...args: Events[K]) => {
      remove();
      return listener(...args);
    };
    remove = this.#add(event, listener, (...args) => wrapper(...args as Events[K]));
    return this;
  }

  off<K extends keyof Events>(event: K, listener: (...args: Events[K]) => unknown): this {
    const entries = this.#listeners.get(event);
    if (!entries) return this;
    for (let index = entries.length - 1; index >= 0; index--) {
      const entry = entries[index];
      if (entry?.key === listener) {
        entries.splice(index, 1);
        break;
      }
    }
    if (!entries.length) this.#listeners.delete(event);
    return this;
  }

  emit<K extends keyof Events>(event: K, ...args: Events[K]): boolean {
    const entries = this.#listeners.get(event);
    if (!entries?.length) return false;
    for (const { wrapper } of [...entries]) {
      try {
        const result = wrapper(...args);
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
    return this.#listeners.get(event)?.length ?? 0;
  }

  removeAllListeners(event?: keyof Events): this {
    if (event === undefined) this.#listeners.clear();
    else this.#listeners.delete(event);
    return this;
  }

  #add<K extends keyof Events>(event: K, key: unknown, wrapper: Listener): () => void {
    let entries = this.#listeners.get(event);
    if (!entries) {
      entries = [];
      this.#listeners.set(event, entries);
    }
    const entry = { key, wrapper };
    entries.push(entry);
    return () => this.#remove(event, entry);
  }

  #remove(event: keyof Events, entry: Entry): void {
    const entries = this.#listeners.get(event);
    if (!entries) return;
    const index = entries.indexOf(entry);
    if (index >= 0) entries.splice(index, 1);
    if (!entries.length) this.#listeners.delete(event);
  }

  #reportListenerError(error: unknown, event: keyof Events): void {
    if (event === 'error') {
      console.error('[micup.ts/voice] an error listener failed', error);
      return;
    }
    const handlers = this.#listeners.get('error' as keyof Events);
    if (!handlers?.length) return;
    const failure = error instanceof Error ? error : new Error(String(error));
    for (const { wrapper: handler } of [...handlers]) {
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
