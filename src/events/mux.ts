import type { GatewayDispatch } from '../gateway/protocol.js';
import type { MicupMessage, MicupUser } from '../rest/client.js';

import type { VoiceServerUpdate } from '../session/voice.js';

import type { MicupChannel, MicupGuildCreate, MicupMember, MicupMembersChunk, MicupRole, MicupVoiceState } from '../model/guild.js';

import type { MicupInteraction } from '../model/interaction.js';

export interface MicupEvents {
  READY: { session_id: string; user: MicupUser; guilds?: MicupGuildCreate[]; private_channels?: MicupChannel[] };
  RESUMED: Record<string, never>;
  MESSAGE_CREATE: MicupMessage;
  MESSAGE_UPDATE: Partial<MicupMessage> & Pick<MicupMessage, 'id' | 'channel_id'>;
  MESSAGE_DELETE: Pick<MicupMessage, 'id' | 'channel_id'> & { guild_id?: string };
  USER_UPDATE: MicupUser;
  INTERACTION_CREATE: MicupInteraction;
  VOICE_STATE_UPDATE: MicupVoiceState;
  GUILD_CREATE: MicupGuildCreate;
  GUILD_SYNC: MicupGuildCreate;
  GUILD_UPDATE: Partial<MicupGuildCreate> & { guild_id?: string };
  GUILD_DELETE: { id: string; unavailable?: boolean };
  GUILD_ROLE_CREATE: { guild_id: string; role: MicupRole };
  GUILD_ROLE_UPDATE: { guild_id: string; role: MicupRole };
  GUILD_ROLE_DELETE: { guild_id: string; role_id: string };
  GUILD_ROLE_UPDATE_BULK: { guild_id: string; roles: MicupRole[] };
  GUILD_MEMBER_ADD: MicupMember & { guild_id: string };
  GUILD_MEMBER_UPDATE: MicupMember & { guild_id: string };
  GUILD_MEMBER_REMOVE: { guild_id: string; user: MicupUser };
  GUILD_MEMBERS_CHUNK: MicupMembersChunk;
  CHANNEL_CREATE: MicupChannel;
  CHANNEL_UPDATE: MicupChannel;
  CHANNEL_DELETE: MicupChannel;
  CHANNEL_UPDATE_BULK: { guild_id?: string; channels: MicupChannel[] };
  THREAD_CREATE: MicupChannel;
  THREAD_UPDATE: MicupChannel;
  THREAD_DELETE: MicupChannel;
  THREAD_LIST_SYNC: { guild_id: string; channel_ids?: string[]; threads: MicupChannel[] };
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
