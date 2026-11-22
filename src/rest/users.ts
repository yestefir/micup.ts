import type { MicupUser } from '../model/entities.js';
import type { MicupChannel, MicupGuild, MicupMember } from '../model/guild.js';
import { compareSnowflakes } from '../model/format.js';
import { snowflake } from './messages.js';
import type { MicupRequestOptions, RestTransport } from './transport.js';

export interface MicupApplication {
  id: string;
  name: string;
  icon?: string | null;
  description?: string | null;
  owner?: MicupUser;
  flags?: number | null;
}

export interface BotProfileEdit {
  username?: string;
  avatar?: string | null;
  banner?: string | null;
}

export interface MicupPublicApplication {
  id: string;
  name: string;
  icon: string | null;
  description: string | null;
  redirect_uris: string[];
  scopes: string[];
  bot_public: boolean;
  bot: { id: string; username: string; discriminator: string; avatar?: string | null; banner?: string | null; bio: string | null } | null;
  current_user?: MicupUser | null;
}

export interface UserProfileOptions extends MicupRequestOptions {
  guildId?: string;
  withMutualFriends?: boolean;
  withMutualGuilds?: boolean;
}

export interface MicupUserProfile {
  user: MicupUser;
  guild_member?: MicupMember;
  mutual_guilds?: { id: string; nick?: string | null }[];
  mutual_friends?: MicupUser[];
}

export class MicupUsers {
  constructor(private readonly rest: RestTransport) {}

  get(userId: string, options?: MicupRequestOptions): Promise<MicupUser> {
    return this.rest.request('GET', '/users/' + snowflake(userId, 'User ID'), options);
  }

  profile(userId: string, { guildId, withMutualFriends, withMutualGuilds, signal }: UserProfileOptions = {}): Promise<MicupUserProfile> {
    const query = new URLSearchParams();
    if (guildId !== undefined) query.set('guild_id', snowflake(guildId, 'Guild ID'));
    if (withMutualFriends) query.set('with_mutual_friends', 'true');
    if (withMutualGuilds) query.set('with_mutual_guilds', 'true');
    return this.rest.request('GET', '/users/' + snowflake(userId, 'User ID') + '/profile', { query, signal });
  }

  createDM(userId: string, options?: MicupRequestOptions): Promise<MicupChannel> {
    return this.rest.request('POST', '/users/@me/channels', { ...options, body: { recipient_id: snowflake(userId, 'User ID') } });
  }

  application(options?: MicupRequestOptions): Promise<MicupApplication> {
    return this.rest.request('GET', '/applications/@me', options);
  }

  editCurrentUser(edit: BotProfileEdit, options?: MicupRequestOptions): Promise<MicupUser> {
    if (edit.username !== undefined && !/^[A-Za-z0-9_]{1,32}$/.test(edit.username)) {
      throw new TypeError('A bot username takes 1 to 32 ASCII letters, digits or underscores');
    }
    return this.rest.request('PATCH', '/users/@me', { ...options, body: edit });
  }

  publicApplication(applicationId: string, options?: MicupRequestOptions): Promise<MicupPublicApplication> {
    return this.rest.request('GET', '/oauth2/applications/' + snowflake(applicationId, 'Application ID') + '/public', { ...options, anonymous: true });
  }

  guilds(
    { before, after, limit, signal }: MicupRequestOptions & { before?: string; after?: string; limit?: number } = {},
  ): Promise<MicupGuild[]> {
    const query = new URLSearchParams();
    if (limit !== undefined) {
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) throw new RangeError('Guild list limit must be between 1 and 200');
      query.set('limit', String(limit));
    }
    if (before !== undefined) query.set('before', snowflake(before, 'Guild cursor'));
    if (after !== undefined) query.set('after', snowflake(after, 'Guild cursor'));
    return this.rest.request('GET', '/users/@me/guilds', { query, signal });
  }

  async *iterateGuilds({ signal }: MicupRequestOptions = {}): AsyncGenerator<MicupGuild> {
    let after: string | undefined;
    while (true) {
      const guilds: MicupGuild[] = await this.guilds({ limit: 200, after, signal });
      for (const guild of guilds) yield guild;
      const next = guilds.at(-1)?.id;
      if (guilds.length < 200 || !next || after !== undefined && compareSnowflakes(next, after) <= 0) return;
      after = next;
    }
  }

  leaveGuild(guildId: string, options?: MicupRequestOptions): Promise<void> {
    return this.rest.request('DELETE', '/users/@me/guilds/' + snowflake(guildId, 'Guild ID'), options);
  }
}
