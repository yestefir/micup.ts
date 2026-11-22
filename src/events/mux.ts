import type { GatewayDispatch } from '../gateway/protocol.js';
import type { MicupMessage, MicupUser } from '../rest/client.js';

import type { VoiceServerUpdate } from '../session/voice.js';

export interface MicupEvents {
  READY: { session_id: string; user: MicupUser };
  RESUMED: Record<string, never>;
  MESSAGE_CREATE: MicupMessage;
  MESSAGE_UPDATE: Partial<MicupMessage> & Pick<MicupMessage, 'id' | 'channel_id'>;
  MESSAGE_DELETE: Pick<MicupMessage, 'id' | 'channel_id'> & { guild_id?: string };
  USER_UPDATE: MicupUser;
  VOICE_STATE_UPDATE: { guild_id: string; user_id: string; channel_id: string | null; connection_id?: string };
  VOICE_SERVER_UPDATE: VoiceServerUpdate;
}

type Payload<Events, Name extends string> = Name extends keyof Events ? Events[Name] : unknown;
type EventHandler<Data = unknown> = (
  data: Data,
  event: GatewayDispatch,
  signal: AbortSignal,
) => void | Promise<void>;

export class EventMux<Events = MicupEvents> {
  readonly #handlers = new Map<string, Set<EventHandler>>();

  on<Name extends string>(name: Name, handler: EventHandler<Payload<Events, Name>>): () => void {
    let handlers = this.#handlers.get(name);
    if (!handlers) {
      handlers = new Set();
      this.#handlers.set(name, handlers);
    }
    const registered: EventHandler = (data, event, signal) =>
      handler(data as Payload<Events, Name>, event, signal);
    handlers.add(registered);
    return () => {
      handlers.delete(registered);
      if (handlers.size === 0 && this.#handlers.get(name) === handlers) this.#handlers.delete(name);
    };
  }

  readonly handle = async (event: GatewayDispatch, signal: AbortSignal): Promise<void> => {
    for (const handler of this.#handlers.get(event.name) ?? []) {
      signal.throwIfAborted();
      await handler(event.data, event, signal);
    }
  };
}
