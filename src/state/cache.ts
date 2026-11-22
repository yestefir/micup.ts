import type { GatewayDispatch } from '../gateway/protocol.js';
import type { MicupChannel, MicupGuild, MicupGuildCreate, MicupMember, MicupMembersChunk, MicupRole, MicupVoiceState } from '../model/guild.js';
import { computePermissions } from '../model/permissions.js';

interface CachedGuild {
  info: MicupGuild;
  roles: Map<string, MicupRole>;
  members: Map<string, MicupMember>;
  voices: Map<string, MicupVoiceState>;
}

const isThread = (type?: number) => type === 10 || type === 11 || type === 12;
const array = <T>(value?: readonly T[]): readonly T[] => Array.isArray(value) ? value : [];

export class GatewayState {
  readonly #guilds = new Map<string, CachedGuild>();
  readonly #channels = new Map<string, MicupChannel>();

  get guildCount(): number {
    return this.#guilds.size;
  }

  clear(): void {
    this.#guilds.clear();
    this.#channels.clear();
  }

  guild(id: string): MicupGuild | undefined {
    const state = this.#guilds.get(id);
    if (!state || state.info.unavailable) return undefined;
    return structuredClone({ ...state.info, roles: [...state.roles.values()] });
  }

  channel(id: string): MicupChannel | undefined {
    return structuredClone(this.#channels.get(id));
  }

  guildForChannel(channelId: string): string | undefined {
    return this.#channels.get(channelId)?.guild_id;
  }

  member(guildId: string, userId: string): MicupMember | undefined {
    return structuredClone(this.#guilds.get(guildId)?.members.get(userId));
  }

  voiceChannel(guildId: string, userId: string): string | undefined {
    return this.#guilds.get(guildId)?.voices.get(userId)?.channel_id ?? undefined;
  }

  voiceMembers(guildId: string, channelId: string): string[] {
    const voices = this.#guilds.get(guildId)?.voices.values() ?? [];
    return [...voices].filter((voice) => voice.channel_id === channelId).map((voice) => voice.user_id).sort();
  }

  permissions(guildId: string, userId: string, channelId?: string): bigint | undefined {
    const guild = this.#guilds.get(guildId);
    if (!guild || guild.info.unavailable || !guild.roles.has(guildId)) return undefined;
    const member = guild.members.get(userId);
    if (!member && userId !== guild.info.owner_id) return undefined;
    let channel: MicupChannel | undefined;
    if (channelId !== undefined) {
      channel = this.#channels.get(channelId);
      if (channel?.guild_id !== guildId) return undefined;
      if (isThread(channel.type)) {
        channel = this.#channels.get(channel.parent_id ?? '');
        if (channel?.guild_id !== guildId) return undefined;
      }
    }
    return computePermissions(guildId, guild.info.owner_id, userId, guild.roles, member?.roles ?? [], channel?.permission_overwrites);
  }

  apply(event: GatewayDispatch): void {
    const { name, data } = event;
    if (!data || typeof data !== 'object') return;

    switch (name) {
      case 'READY': {
        const ready = data as { guilds?: MicupGuildCreate[]; private_channels?: MicupChannel[] };
        this.clear();
        for (const guild of array(ready.guilds)) this.#replaceGuild(guild);
        for (const channel of array(ready.private_channels)) this.#storeChannel(channel);
        break;
      }
      case 'GUILD_CREATE':
      case 'GUILD_SYNC':
        this.#replaceGuild(data as MicupGuildCreate);
        break;
      case 'GUILD_UPDATE': {
        const { properties, roles, guild_id, ...info } = data as MicupGuildCreate & { guild_id?: string };
        const id = info.id || guild_id;
        if (!id) return;
        const state = this.#guild(id);
        Object.assign(state.info, { ...structuredClone(properties), ...structuredClone(info), id });
        for (const role of array(roles)) this.#storeRole(state, role);
        break;
      }
      case 'GUILD_DELETE': {
        const guild = data as MicupGuild & { guild_id?: string };
        const id = guild.id || guild.guild_id;
        if (!id) return;
        if (guild.unavailable) this.#guild(id).info.unavailable = true;
        else {
          this.#guilds.delete(id);
          this.#removeGuildChannels(id);
        }
        break;
      }
      case 'GUILD_ROLE_CREATE':
      case 'GUILD_ROLE_UPDATE':
      case 'GUILD_ROLE_UPDATE_BULK': {
        const { guild_id, roles, role } = data as { guild_id?: string; roles?: MicupRole[]; role?: MicupRole };
        if (!guild_id) return;
        const guild = this.#guild(guild_id);
        for (const entry of role ? [role] : array(roles)) this.#storeRole(guild, entry);
        break;
      }
      case 'GUILD_ROLE_DELETE': {
        const { guild_id, role_id } = data as { guild_id: string; role_id: string };
        const guild = this.#guilds.get(guild_id);
        guild?.roles.delete(role_id);
        if (guild) {
          for (const member of guild.members.values()) member.roles = array(member.roles).filter((id) => id !== role_id);
        }
        break;
      }
      case 'GUILD_MEMBER_ADD':
      case 'GUILD_MEMBER_UPDATE': {
        const member = data as MicupMember & { guild_id?: string };
        if (member.guild_id) this.#storeMember(this.#guild(member.guild_id), member);
        break;
      }
      case 'GUILD_MEMBER_REMOVE': {
        const { guild_id, user } = data as MicupMember & { guild_id: string };
        if (!user?.id) return;
        this.#guilds.get(guild_id)?.members.delete(user.id);
        this.#guilds.get(guild_id)?.voices.delete(user.id);
        break;
      }
      case 'GUILD_MEMBERS_CHUNK': {
        const { guild_id, members } = data as MicupMembersChunk;
        if (!guild_id) return;
        for (const member of array(members)) this.#storeMember(this.#guild(guild_id), member);
        break;
      }
      case 'CHANNEL_CREATE':
      case 'CHANNEL_UPDATE':
      case 'THREAD_CREATE':
      case 'THREAD_UPDATE':
        this.#storeChannel(data as MicupChannel);
        break;
      case 'CHANNEL_DELETE':
      case 'THREAD_DELETE':
        this.#channels.delete((data as MicupChannel).id);
        break;
      case 'CHANNEL_UPDATE_BULK': {
        const { guild_id, channels } = data as { guild_id?: string; channels?: MicupChannel[] };
        for (const channel of array(channels)) this.#storeChannel(channel, guild_id);
        break;
      }
      case 'THREAD_LIST_SYNC': {
        const { guild_id, channel_ids, threads } = data as { guild_id: string; channel_ids?: string[]; threads?: MicupChannel[] };
        if (!guild_id) return;
        const parents = new Set(array(channel_ids));
        for (const [id, channel] of this.#channels) {
          if (channel.guild_id === guild_id && isThread(channel.type) &&
              (!parents.size || parents.has(channel.parent_id ?? ''))) this.#channels.delete(id);
        }
        for (const thread of array(threads)) this.#storeChannel(thread, guild_id);
        break;
      }
      case 'GUILD_EMOJIS_UPDATE':
      case 'GUILD_STICKERS_UPDATE': {
        const { guild_id, emojis, stickers } = data as Pick<MicupGuild, 'emojis' | 'stickers'> & { guild_id?: string };
        if (!guild_id) return;
        const field = name === 'GUILD_EMOJIS_UPDATE' ? 'emojis' : 'stickers';
        this.#guild(guild_id).info[field] = structuredClone(field === 'emojis' ? emojis ?? [] : stickers ?? []);
        break;
      }
      case 'VOICE_STATE_UPDATE': {
        const voice = data as MicupVoiceState;
        if (voice.guild_id) this.#storeVoice(this.#guild(voice.guild_id), voice);
        break;
      }
      case 'MESSAGE_CREATE': {
        const { guild_id, member, author } = data as { guild_id?: string; member?: MicupMember; author?: MicupMember['user'] };
        if (guild_id && member && author) this.#storeMember(this.#guild(guild_id), { ...member, user: author });
        break;
      }
    }
  }

  #guild(id: string): CachedGuild {
    let state = this.#guilds.get(id);
    if (!state) {
      state = { info: { id }, roles: new Map(), members: new Map(), voices: new Map() };
      this.#guilds.set(id, state);
    }
    return state;
  }

  #replaceGuild(guild: MicupGuildCreate): void {
    if (!guild?.id) return;
    const { id, properties, channels, threads, voice_states, members, roles, ...info } = guild;
    const state = this.#guild(id);
    if (info.unavailable) {
      state.info.unavailable = true;
      return;
    }
    state.info = { ...structuredClone(properties), ...structuredClone(info), id, unavailable: false };
    state.roles.clear();
    state.voices.clear();
    this.#removeGuildChannels(id);
    for (const role of array(roles)) this.#storeRole(state, role);
    for (const channel of [...array(channels), ...array(threads)]) this.#storeChannel(channel, id);
    for (const member of array(members)) this.#storeMember(state, member);
    for (const voice of array(voice_states)) this.#storeVoice(state, voice);
  }

  #removeGuildChannels(guildId: string): void {
    for (const [id, channel] of this.#channels) {
      if (channel.guild_id === guildId) this.#channels.delete(id);
    }
  }

  #storeChannel(channel: MicupChannel, guildId?: string): void {
    if (!channel?.id) return;
    const previous = this.#channels.get(channel.id);
    const guild = guildId ?? channel.guild_id ?? previous?.guild_id;
    this.#channels.set(channel.id, { ...previous, ...structuredClone(channel), guild_id: guild });
  }

  #storeRole(state: CachedGuild, role: MicupRole): void {
    if (role?.id) state.roles.set(role.id, { ...state.roles.get(role.id), ...structuredClone(role) });
  }

  #storeMember(state: CachedGuild, member: MicupMember): void {
    if (member?.user?.id) {
      state.members.set(member.user.id, { ...state.members.get(member.user.id), ...structuredClone(member) });
    }
  }

  #storeVoice(state: CachedGuild, voice: MicupVoiceState): void {
    if (!voice?.user_id) return;
    if (!voice.channel_id) state.voices.delete(voice.user_id);
    else state.voices.set(voice.user_id, structuredClone(voice));
    if (voice.member) this.#storeMember(state, voice.member);
  }
}
