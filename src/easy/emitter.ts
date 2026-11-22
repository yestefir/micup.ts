type Listener = (...args: any[]) => unknown;

export class Emitter {
  readonly #listeners = new Map<string, Map<Listener, Listener>>();

  add(event: string, key: Listener, wrapper: Listener = key): void {
    let entries = this.#listeners.get(event);
    if (!entries) {
      entries = new Map();
      this.#listeners.set(event, entries);
    }
    entries.set(key, wrapper);
  }

  remove(event: string, key: Listener): void {
    const entries = this.#listeners.get(event);
    entries?.delete(key);
    if (entries && !entries.size) this.#listeners.delete(event);
  }

  listeners(event: string): Listener[] {
    return [...(this.#listeners.get(event)?.values() ?? [])];
  }

  count(event: string): number {
    return this.#listeners.get(event)?.size ?? 0;
  }

  clear(event?: string): void {
    if (event === undefined) this.#listeners.clear();
    else this.#listeners.delete(event);
  }
}
