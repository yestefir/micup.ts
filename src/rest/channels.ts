import type { MicupChannel, MicupMember, PermissionOverwrite, ThreadMember } from '../model/guild.js';
import type { MicupMessage, MicupUser } from '../model/entities.js';
import { compareSnowflakes } from '../model/format.js';
import { guildPath, type AuditOptions, type SudoProof } from './guilds.js';
import { messageBody, messagesPath, snowflake, type MessageInput } from './messages.js';
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

export interface CrosspostSource {
  guild: {
    id: string; name: string; icon: string | null; banner: string | null; description: string | null;
    features: string[]; badge_ids: string[]; approximate_member_count: number | null;
    approximate_presence_count: number | null; discoverable: boolean;
  };
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


export interface ForumTag {
  name: string;
  emoji_id?: string | null;
  emoji_name?: string | null;
  moderated?: boolean;
}

export interface ForumPostInput extends Omit<ThreadStart, 'type' | 'invitable'> {
  message: MessageInput;
  applied_tags?: readonly string[];
}

export interface ForumPost extends MicupChannel {
  message?: MicupMessage;
}

export interface ArchivedThreadOptions extends MicupRequestOptions {
  before?: string;
  limit?: number;
  kind?: 'public' | 'private' | 'joined';
}

function threadStart(input: Pick<ThreadStart, 'name' | 'auto_archive_duration' | 'rate_limit_per_user'>): typeof input {
  if (!input.name || [...input.name].length > 100) throw new TypeError('Thread names must contain 1 to 100 characters');
  if (input.auto_archive_duration !== undefined && ![60, 1440, 4320, 10080].includes(input.auto_archive_duration)) {
    throw new RangeError('Invalid Micup auto archive duration');
  }
  return input;
}

function forumTag(tag: ForumTag): ForumTag {
  if (!tag.name || [...tag.name].length > 50 || tag.emoji_id && tag.emoji_name) throw new TypeError('Invalid Micup forum tag');
  return tag;
}

export interface ReactionUsersPage {
  items: MicupUser[];
  has_more: boolean;
  next_after?: string | null;
}

function invitePath(code: string): string {
  if (!code || code === '.' || code === '..') throw new TypeError('A Micup invite code is required');
  return '/invites/' + encodeURIComponent(code);
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

  async *iteratePins(id: string, { signal }: MicupRequestOptions = {}): AsyncGenerator<{ message: MicupMessage; pinned_at: string }> {
    const seen = new Set<string>();
    let before: string | undefined;
    while (true) {
      const query = new URLSearchParams({ limit: '50' });
      if (before !== undefined) query.set('before', before);
      const page = await this.pins(id, query, { signal });
      let fresh = 0;
      for (const pin of page.items) {
        if (seen.has(pin.message.id)) continue;
        seen.add(pin.message.id);
        fresh++;
        yield pin;
      }
      if (!page.has_more || fresh === 0) return;
      before = page.items.at(-1)!.pinned_at;
    }
  }

  async *iterateThreadMembers(
    threadId: string, { withMember = false, signal }: MicupRequestOptions & { withMember?: boolean } = {},
  ): AsyncGenerator<ThreadMember> {
    let after: string | undefined;
    while (true) {
      const query = new URLSearchParams({ limit: '100' });
      if (withMember) query.set('with_member', 'true');
      if (after !== undefined) query.set('after', snowflake(after, 'Thread member cursor'));
      const page: ThreadMember[] = await this.threadMembers(threadId, query, { signal });
      let next = after;
      for (const member of page) {
        yield member;
        next = member.user_id ?? next;
      }
      if (page.length < 100 || !next || after !== undefined && compareSnowflakes(next, after) <= 0) return;
      after = next;
    }
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
    threadStart(body);
    if (options.messageId !== undefined && (body.type !== undefined || body.invitable !== undefined)) {
      throw new TypeError('A thread from a message takes only a name, archive duration and slowmode');
    }
    const base = options.messageId === undefined ? channelPath(id) : messagesPath(id, options.messageId);
    const payload = options.messageId === undefined ? { ...body, type: body.type ?? 11 } : body;
    return this.rest.request('POST', base + '/threads', { ...options, body: payload });
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

  createForumPost(channelId: string, { message, applied_tags, ...input }: ForumPostInput, options?: AuditOptions): Promise<ForumPost> {
    threadStart(input);
    if (applied_tags !== undefined && !Array.isArray(applied_tags)) throw new TypeError('Forum post tags must be an array');
    if ((applied_tags?.length ?? 0) > 5 || message.nonce || message.enforce_nonce || message.tts) {
      throw new TypeError('Invalid forum post tags or message options');
    }
    for (const tagId of applied_tags ?? []) snowflake(tagId, 'Forum tag ID');
    if (!message.content && !message.embeds?.length && !message.files?.length && !message.uploads?.length && !message.sticker_ids?.length) {
      throw new TypeError('A forum post requires content, an embed, an attachment or a sticker');
    }
    const first = messageBody(message);
    const post = { ...input, applied_tags };
    if (first instanceof FormData) {
      first.set('payload_json', JSON.stringify({ ...post, message: JSON.parse(String(first.get('payload_json'))) }));
      return this.rest.request('POST', channelPath(channelId) + '/threads', { ...options, body: first });
    }
    return this.rest.request('POST', channelPath(channelId) + '/threads', { ...options, body: { ...post, message: first } });
  }

  archivedThreads(id: string, { before, limit, kind = 'public', signal }: ArchivedThreadOptions = {}): Promise<ThreadList> {
    if (!['public', 'private', 'joined'].includes(kind)) throw new TypeError('Archived thread kind must be public, private or joined');
    const suffix = kind === 'joined' ? '/users/@me/threads/archived/private' : '/threads/archived/' + kind;
    const query = new URLSearchParams();
    if (before) query.set('before', before);
    if (limit !== undefined) {
      if (!Number.isInteger(limit) || limit < 2 || limit > 100) throw new RangeError('Archived threads take 2 to 100 entries per page');
      query.set('limit', String(limit));
    }
    return this.rest.request('GET', channelPath(id) + suffix, { query, signal });
  }

  searchThreads(id: string, query: URLSearchParams, options?: MicupRequestOptions): Promise<ThreadList> {
    return this.rest.request('GET', channelPath(id) + '/threads/search', { ...options, query });
  }

  addThreadMember(threadId: string, userId: string, options?: MicupRequestOptions): Promise<void> {
    return this.rest.request('PUT', channelPath(threadId) + '/thread-members/' + snowflake(userId, 'User ID'), options);
  }

  removeThreadMember(threadId: string, userId: string, options?: MicupRequestOptions): Promise<void> {
    return this.rest.request('DELETE', channelPath(threadId) + '/thread-members/' + snowflake(userId, 'User ID'), options);
  }

  createForumTag(channelId: string, tag: ForumTag, options?: AuditOptions): Promise<MicupChannel> {
    return this.rest.request('POST', channelPath(channelId) + '/tags', { ...options, body: forumTag(tag) });
  }

  editForumTag(channelId: string, tagId: string, tag: ForumTag, options?: AuditOptions): Promise<MicupChannel> {
    const path = channelPath(channelId) + '/tags/' + snowflake(tagId, 'Tag ID');
    return this.rest.request('PUT', path, { ...options, body: forumTag(tag) });
  }

  deleteForumTag(channelId: string, tagId: string, options?: AuditOptions): Promise<MicupChannel> {
    return this.rest.request('DELETE', channelPath(channelId) + '/tags/' + snowflake(tagId, 'Tag ID'), options);
  }

  reactionUsers(id: string, messageId: string, emoji: string, query?: URLSearchParams, options?: MicupRequestOptions): Promise<ReactionUsersPage> {
    return this.rest.request('GET', reactionPath(id, messageId, emoji) + '/users', { ...options, query });
  }

  async *iterateReactionUsers(id: string, messageId: string, emoji: string, options?: MicupRequestOptions): AsyncGenerator<MicupUser> {
    const query = new URLSearchParams({ limit: '100' });
    while (true) {
      const page = await this.reactionUsers(id, messageId, emoji, query, options);
      yield* page.items;
      if (!page.has_more || !page.next_after) return;
      const next = snowflake(page.next_after, 'Reaction user cursor');
      const current = query.get('after');
      if (current !== null && compareSnowflakes(next, current) <= 0) return;
      query.set('after', next);
    }
  }

  deleteReaction(id: string, messageId: string, { emoji, userId }: { emoji?: string; userId?: string } = {}, options?: MicupRequestOptions): Promise<void> {
    if (userId !== undefined && emoji === undefined) throw new TypeError('A user reaction needs an emoji');
    const path = emoji === undefined ? messagesPath(id, messageId) + '/reactions' : reactionPath(id, messageId, emoji);
    return this.rest.request('DELETE', path + (userId === undefined ? '' : '/' + snowflake(userId, 'User ID')), options);
  }

  addRecipient(channelId: string, userId: string, options?: MicupRequestOptions): Promise<void> {
    return this.rest.request('PUT', channelPath(channelId) + '/recipients/' + snowflake(userId, 'User ID'), options);
  }

  removeRecipient(channelId: string, userId: string, { silent, signal }: MicupRequestOptions & { silent?: boolean } = {}): Promise<void> {
    const query = silent === undefined ? undefined : new URLSearchParams({ silent: String(silent) });
    return this.rest.request('DELETE', channelPath(channelId) + '/recipients/' + snowflake(userId, 'User ID'), { query, signal });
  }

  deleteOwnMessages(channelId: string, { signal, ...proof }: MicupRequestOptions & SudoProof = {}): Promise<void> {
    return this.rest.request('POST', messagesPath(channelId) + '/bulk-delete-mine', { signal, body: proof });
  }

  crosspostSource(channelId: string, messageId: string, options?: MicupRequestOptions): Promise<CrosspostSource> {
    return this.rest.request('GET', messagesPath(channelId, messageId) + '/crosspost-source', options);
  }

  archiveThread(threadId: string, archived = true, options?: AuditOptions): Promise<MicupChannel> {
    return this.edit(threadId, { archived }, options);
  }

  lockThread(threadId: string, locked = true, options?: AuditOptions): Promise<MicupChannel> {
    return this.edit(threadId, { locked }, options);
  }

  follow(announcementId: string, targetId: string, options?: AuditOptions): Promise<{ channel_id: string; webhook_id: string }> {
    return this.rest.request('POST', channelPath(announcementId) + '/followers', {
      ...options, body: { webhook_channel_id: snowflake(targetId, 'Target channel ID') },
    });
  }

  followerStats(announcementId: string, options?: MicupRequestOptions): Promise<{ channel_count: number; guild_count: number }> {
    return this.rest.request('GET', channelPath(announcementId) + '/follower-stats', options);
  }

  async forumPostData(
    channelId: string, threadIds: readonly string[], options?: MicupRequestOptions,
  ): Promise<Record<string, { owner?: MicupMember | null; first_message?: MicupMessage | null }>> {
    if (!Array.isArray(threadIds)) throw new TypeError('Forum post thread IDs must be an array');
    const ids = [...new Set(Array.from(threadIds, (id) => snowflake(id, 'Thread ID')))];
    if (!ids.length || ids.length > 100) throw new RangeError('Forum post data accepts 1 to 100 thread IDs');
    const result = await this.rest.request<{ threads: Record<string, { owner?: MicupMember | null; first_message?: MicupMessage | null }> }>(
      'POST', channelPath(channelId) + '/post-data', { ...options, body: { thread_ids: ids }, idempotent: true },
    );
    return result.threads;
  }

  threadMembers(threadId: string, query?: URLSearchParams, options?: MicupRequestOptions): Promise<ThreadMember[]> {
    return this.rest.request('GET', channelPath(threadId) + '/thread-members', { ...options, query });
  }

  threadMember(threadId: string, userId: string, withMember = false, options?: MicupRequestOptions): Promise<ThreadMember> {
    const query = withMember ? new URLSearchParams({ with_member: 'true' }) : undefined;
    return this.rest.request('GET', channelPath(threadId) + '/thread-members/' + snowflake(userId, 'User ID'), { ...options, query });
  }

  guildInvites(guildId: string, options?: MicupRequestOptions): Promise<MicupInvite[]> {
    return this.rest.request('GET', guildPath(guildId) + '/invites', options);
  }

  getInvite(code: string, options?: MicupRequestOptions): Promise<MicupInvite> {
    return this.rest.request('GET', invitePath(code), options);
  }

  deleteInvite(code: string, options?: AuditOptions): Promise<void> {
    return this.rest.request('DELETE', invitePath(code), options);
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
