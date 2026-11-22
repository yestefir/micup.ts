type Listener = (...args: unknown[]) => unknown;

interface Entry {
  key: Listener;
  wrapper: Listener;
}

export class Emitter {
  readonly #listeners = new Map<string, Entry[]>();

  add(event: string, key: Listener, wrapper: Listener = key): () => void {
    let entries = this.#listeners.get(event);
    if (!entries) {
      entries = [];
      this.#listeners.set(event, entries);
    }
    const entry = { key, wrapper };
    entries.push(entry);
    return () => this.#removeEntry(event, entry);
  }

  remove(event: string, key: Listener): void {
    const entries = this.#listeners.get(event);
    if (!entries) return;
    for (let index = entries.length - 1; index >= 0; index--) {
      const entry = entries[index];
      if (entry?.key === key) {
        entries.splice(index, 1);
        break;
      }
    }
    if (!entries.length) this.#listeners.delete(event);
  }

  listeners(event: string): Listener[] {
    return (this.#listeners.get(event) ?? []).map(({ wrapper }) => wrapper);
  }

  count(event: string): number {
    return this.#listeners.get(event)?.length ?? 0;
  }

  clear(event?: string): void {
    if (event === undefined) this.#listeners.clear();
    else this.#listeners.delete(event);
  }

  #removeEntry(event: string, entry: Entry): void {
    const entries = this.#listeners.get(event);
    if (!entries) return;
    const index = entries.indexOf(entry);
    if (index >= 0) entries.splice(index, 1);
    if (!entries.length) this.#listeners.delete(event);
  }
}
