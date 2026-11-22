import type { MicupUser } from '../model/entities.js';
import type { EventMux } from './mux.js';

export interface GuildTagChange {
  userId: string;
  guildId?: string;
  previous?: string;
  current?: string;
  cleared: boolean;
}

export function onGuildTagChange(
  events: EventMux,
  listener: (change: GuildTagChange, signal: AbortSignal) => void | Promise<void>,
): () => void {
  const tags = new Map<string, string>();
  const remember = (user?: MicupUser): string | undefined => {
    if (!user?.id) return undefined;
    const previous = tags.get(user.id);
    if (user.tag_guild_id) tags.set(user.id, user.tag_guild_id);
    else tags.delete(user.id);
    return previous;
  };
  const notify = async (user: MicupUser | undefined, signal: AbortSignal, guildId?: string) => {
    if (!user?.id || !Object.hasOwn(user, 'tag_guild_id')) return;
    const previous = remember(user);
    const current = user.tag_guild_id || undefined;
    if (previous === current) return;
    await listener({ userId: user.id, guildId, previous, current, cleared: !current }, signal);
  };
  const registrations = [
    events.on('GUILD_MEMBER_ADD', (member, event, signal) => notify(member.user, signal, member.guild_id)),
    events.on('GUILD_MEMBER_UPDATE', (member, event, signal) => notify(member.user, signal, member.guild_id)),
    events.on('USER_UPDATE', (user, event, signal) => notify(user, signal)),
    events.on('GUILD_MEMBERS_CHUNK', ({ members }) => {
      for (const member of members) {
        if (member.user && Object.hasOwn(member.user, 'tag_guild_id')) remember(member.user);
      }
    }),
  ];
  return () => {
    for (const unregister of registrations) unregister();
    tags.clear();
  };
}
