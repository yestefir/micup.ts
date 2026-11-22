import { InteractionType, commandPath, type MicupInteraction } from '../model/interaction.js';

type InteractionHandler = (interaction: MicupInteraction, signal: AbortSignal) => void | Promise<void>;
type Routes = Map<string, InteractionHandler>;

export class InteractionRouter {
  readonly #routes = new Map<number, Routes>();

  command(path: string, handler: InteractionHandler): this {
    return this.#set(InteractionType.Command, path, handler);
  }

  autocomplete(path: string, handler: InteractionHandler): this {
    return this.#set(InteractionType.Autocomplete, path, handler);
  }

  component(customId: string, handler: InteractionHandler): this {
    return this.#set(InteractionType.Component, customId, handler);
  }

  modal(customId: string, handler: InteractionHandler): this {
    return this.#set(InteractionType.Modal, customId, handler);
  }

  #set(type: number, key: string, handler: InteractionHandler): this {
    if (!key || typeof handler !== 'function') throw new TypeError('Interaction route and handler are required');
    let routes = this.#routes.get(type);
    if (!routes) {
      routes = new Map();
      this.#routes.set(type, routes);
    }
    routes.set(key, handler);
    return this;
  }

  async handle(interaction: MicupInteraction, signal: AbortSignal): Promise<boolean> {
    const routes = this.#routes.get(interaction.type);
    if (!routes || !interaction.data) return false;
    let key: string | undefined;
    if (interaction.type === 2 || interaction.type === 4) key = commandPath(interaction.data).join(' ');
    if (interaction.type === 3 || interaction.type === 5) key = interaction.data.custom_id;
    if (!key) return false;

    let handler = routes.get(key);
    if (!handler) {
      let longest = -1;
      for (const [candidate, route] of routes) {
        if (candidate.endsWith('*') && candidate.length > longest && key.startsWith(candidate.slice(0, -1))) {
          longest = candidate.length;
          handler = route;
        }
      }
    }
    if (!handler) return false;
    signal.throwIfAborted();
    await handler(interaction, signal);
    return true;
  }
}
