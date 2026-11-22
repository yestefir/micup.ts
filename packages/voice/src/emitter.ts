type Listener = (...args: any[]) => void;

export class TypedEmitter<Events extends { [K in keyof Events]: unknown[] }> {
  readonly #listeners = new Map<keyof Events, Map<Listener, Listener>>();

  on<K extends keyof Events>(event: K, listener: (...args: Events[K]) => void): this {
    return this.#add(event, listener, listener);
  }

  once<K extends keyof Events>(event: K, listener: (...args: Events[K]) => void): this {
    const wrapper = (...args: Events[K]) => {
      this.off(event, listener);
      listener(...args);
    };
    return this.#add(event, listener, wrapper);
  }

  off<K extends keyof Events>(event: K, listener: (...args: Events[K]) => void): this {
    const entries = this.#listeners.get(event);
    entries?.delete(listener as Listener);
    if (entries && !entries.size) this.#listeners.delete(event);
    return this;
  }

  emit<K extends keyof Events>(event: K, ...args: Events[K]): boolean {
    const entries = this.#listeners.get(event);
    if (!entries?.size) return false;
    for (const wrapper of [...entries.values()]) (wrapper as (...values: Events[K]) => void)(...args);
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

  #add<K extends keyof Events>(event: K, key: (...args: Events[K]) => void, wrapper: (...args: Events[K]) => void): this {
    let entries = this.#listeners.get(event);
    if (!entries) {
      entries = new Map();
      this.#listeners.set(event, entries);
    }
    entries.set(key as Listener, wrapper as Listener);
    return this;
  }
}
