import type { MicupChannel, PermissionOverwrite } from '../model/guild.js';
import type { MicupMessage, MicupUser } from './client.js';
import { guildPath, type AuditOptions } from './guilds.js';
import { messagesPath, snowflake } from './messages.js';
import type { MicupRequestOptions, RestTransport } from './transport.js';

export interface ChannelEdit {
  name?: string;
  topic?: string | null;
  type?: number;
  parent_id?: string | null;
  bitrate?: number;
  user_limit?: number;
  position?: number;
  permission_overwrites?: readonly PermissionOverwrite[];
  archived?: boolean;
  locked?: boolean;
  auto_archive_duration?: number;
  rate_limit_per_user?: number;
  nsfw?: boolean;
}

export interface ThreadStart {
  name: string;
  type?: 10 | 11 | 12;
  auto_archive_duration?: number;
  rate_limit_per_user?: number;
  invitable?: boolean;
}

export interface ThreadList {
  threads: MicupChannel[];
  has_more?: boolean;
  members?: { id?: string; user_id?: string; join_timestamp?: string }[];
  first_messages?: MicupMessage[];
}

export interface MicupInvite {
  code: string;
  type?: number;
  channel_id?: string;
  guild_id?: string;
  inviter?: MicupUser;
  max_age?: number;
  max_uses?: number;
  expires_at?: string | null;
}

function channelPath(channelId: string): string {
  return '/channels/' + snowflake(channelId, 'Channel ID');
}

function reactionPath(channelId: string, messageId: string, emoji: string): string {
  if (!emoji || Buffer.byteLength(emoji) > 64 || emoji === '.' || emoji === '..') throw new TypeError('Invalid Micup emoji');
  return messagesPath(channelId, messageId) + '/reactions/' + encodeURIComponent(emoji);
}

export class MicupChannels {
  constructor(private readonly rest: RestTransport) {}

  get(id: string, options?: MicupRequestOptions): Promise<MicupChannel> {
    return this.rest.request('GET', channelPath(id), options);
  }

  create(guildId: string, body: ChannelEdit & { name: string }, options?: AuditOptions): Promise<MicupChannel> {
    return this.rest.request('POST', guildPath(guildId) + '/channels', { ...options, body });
  }

  edit(id: string, body: ChannelEdit, options?: AuditOptions): Promise<MicupChannel> {
    return this.rest.request('PATCH', channelPath(id), { ...options, body });
  }

  delete(id: string, options?: AuditOptions): Promise<void> {
    return this.rest.request('DELETE', channelPath(id), options);
  }

  setPermission(id: string, { id: target, ...body }: PermissionOverwrite, options?: AuditOptions): Promise<void> {
    return this.rest.request('PUT', channelPath(id) + '/permissions/' + snowflake(target, 'Overwrite ID'), { ...options, body });
  }

  deletePermission(id: string, overwriteId: string, options?: AuditOptions): Promise<void> {
    return this.rest.request('DELETE', channelPath(id) + '/permissions/' + snowflake(overwriteId, 'Overwrite ID'), options);
  }

  pin(id: string, messageId: string, options?: AuditOptions): Promise<void> {
    return this.rest.request('PUT', channelPath(id) + '/pins/' + snowflake(messageId, 'Message ID'), options);
  }

  unpin(id: string, messageId: string, options?: AuditOptions): Promise<void> {
    return this.rest.request('DELETE', channelPath(id) + '/pins/' + snowflake(messageId, 'Message ID'), options);
  }

  pins(id: string, query?: URLSearchParams, options?: MicupRequestOptions): Promise<{ items: { message: MicupMessage; pinned_at: string }[]; has_more: boolean }> {
    return this.rest.request('GET', messagesPath(id) + '/pins', { ...options, query });
  }

  addReaction(id: string, messageId: string, emoji: string, options?: MicupRequestOptions): Promise<void> {
    return this.rest.request('PUT', reactionPath(id, messageId, emoji) + '/@me', options);
  }

  removeReaction(id: string, messageId: string, emoji: string, options?: MicupRequestOptions): Promise<void> {
    return this.rest.request('DELETE', reactionPath(id, messageId, emoji) + '/@me', options);
  }

  startThread(
    id: string, body: ThreadStart, options: AuditOptions & { messageId?: string } = {},
  ): Promise<MicupChannel> {
    const base = options.messageId === undefined ? channelPath(id) : messagesPath(id, options.messageId);
    return this.rest.request('POST', base + '/threads', { ...options, body });
  }

  activeThreads(guildId: string, options?: MicupRequestOptions): Promise<ThreadList> {
    return this.rest.request('GET', guildPath(guildId) + '/threads/active', options);
  }

  joinThread(threadId: string, options?: MicupRequestOptions): Promise<void> {
    return this.rest.request('PUT', channelPath(threadId) + '/thread-members/@me', options);
  }

  leaveThread(threadId: string, options?: MicupRequestOptions): Promise<void> {
    return this.rest.request('DELETE', channelPath(threadId) + '/thread-members/@me', options);
  }

  invites(channelId: string, options?: MicupRequestOptions): Promise<MicupInvite[]> {
    return this.rest.request('GET', channelPath(channelId) + '/invites', options);
  }

  createInvite(
    channelId: string, body: { max_uses?: number; max_age?: number; temporary?: boolean; unique?: boolean } = {}, options?: AuditOptions,
  ): Promise<MicupInvite> {
    return this.rest.request('POST', channelPath(channelId) + '/invites', { ...options, body });
  }
}
