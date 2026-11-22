import type { MessageAttachment, MicupMessage, MicupUser } from '../model/entities.js';
import { MessageFlag } from '../model/entities.js';
import { memberDisplayName, mentionChannel, mentionUser, snowflakeTime, userDisplayName, userTag } from '../model/format.js';
import type { MicupChannel, MicupGuild, MicupGuildCreate, MicupMember, MicupRole } from '../model/guild.js';
import { ChannelType, MessageType } from '../model/constants.js';
import type { MediaOptions } from '../model/media.js';
import { hasPermissions } from '../model/permissions.js';
import type { ChannelEdit, MicupInvite } from '../rest/channels.js';
import type { GuildBanInput } from '../rest/guilds.js';
import type { ListMessageOptions, MessageInput } from '../rest/messages.js';
import type { MicupRequestOptions } from '../rest/transport.js';
import type { Client } from './client.js';

export type MessageContent = string | MessageInput;

export interface ReasonOptions extends MicupRequestOptions {
  reason?: string;
}

function cleanEmoji(emoji: string): string {
  const custom = /^<a?:([A-Za-z0-9_]{2,32}):(\d+)>$/.exec(emoji);
  return custom ? custom[1] + ':' + custom[2] : emoji;
}

export class User {
  constructor(readonly client: Client, readonly raw: MicupUser) {}

  get id(): string {
    return this.raw.id;
  }

  get username(): string {
    return this.raw.username;
  }

  get globalName(): string | null {
    return this.raw.global_name ?? null;
  }

  get displayName(): string {
    return userDisplayName(this.raw);
  }

  get tag(): string {
    return userTag(this.raw);
  }

  get bot(): boolean {
    return this.raw.bot === true;
  }

  get system(): boolean {
    return this.raw.system === true;
  }

  get mention(): string {
    return mentionUser(this.id);
  }

  get createdAt(): Date {
    return snowflakeTime(this.id);
  }

  avatarURL(options?: MediaOptions): string {
    return this.client.rest.media.userAvatar(this.raw, options);
  }

  bannerURL(options?: MediaOptions): string {
    return this.client.rest.media.userBanner(this.raw, options);
  }

  async createDM(options?: MicupRequestOptions): Promise<Channel> {
    return new Channel(this.client, await this.client.rest.users.createDM(this.id, options));
  }

  async send(content: MessageContent, options?: MicupRequestOptions): Promise<Message> {
    return new Message(this.client, await this.client.rest.sendDM(this.id, content, options));
  }

  async fetch(options?: MicupRequestOptions): Promise<User> {
    return new User(this.client, await this.client.rest.users.get(this.id, options));
  }

  equals(other: { id: string } | string): boolean {
    return this.id === (typeof other === 'string' ? other : other.id);
  }

  toString(): string {
    return this.mention;
  }
}

export class Member {
  readonly user: User | undefined;

  constructor(readonly client: Client, readonly raw: MicupMember, readonly guildId: string) {
    this.user = raw.user ? new User(client, raw.user) : undefined;
  }

  get id(): string {
    return this.user?.id ?? '';
  }

  get nick(): string | null {
    return this.raw.nick ?? null;
  }

  get roles(): readonly string[] {
    return this.raw.roles;
  }

  get displayName(): string {
    return this.raw.user || this.raw.nick ? memberDisplayName(this.raw) : '';
  }

  get joinedAt(): Date | undefined {
    return this.raw.joined_at ? new Date(this.raw.joined_at) : undefined;
  }

  get communicationDisabledUntil(): Date | null {
    return this.raw.communication_disabled_until ? new Date(this.raw.communication_disabled_until) : null;
  }

  get bot(): boolean {
    return this.user?.bot ?? false;
  }

  get guild(): Guild | undefined {
    return this.client.guilds.get(this.guildId);
  }

  avatarURL(options?: MediaOptions): string {
    return this.client.rest.media.memberAvatar(this.guildId, this.raw, options);
  }

  isTimedOut(now = new Date()): boolean {
    const until = this.communicationDisabledUntil;
    return until !== null && until.getTime() > now.getTime();
  }

  hasRole(roleId: string): boolean {
    return this.raw.roles.includes(roleId);
  }

  permissions(channelId?: string): bigint | undefined {
    return this.client.permissionsFor(this.guildId, this.id, channelId);
  }

  hasPermission(permission: bigint, channelId?: string): boolean {
    const granted = this.permissions(channelId);
    return granted !== undefined && hasPermissions(granted, permission);
  }

  kick(options?: ReasonOptions): Promise<void> {
    return this.client.rest.guilds.kick(this.guildId, this.id, options);
  }

  ban(options: GuildBanInput & ReasonOptions = {}): Promise<void> {
    const { signal, reason, ...input } = options;
    return this.client.rest.guilds.ban(this.guildId, this.id, { ...input, ...(reason !== undefined && { reason }) }, { signal, reason });
  }

  async timeout(durationMs: number, options?: ReasonOptions & { timeoutReason?: string }): Promise<Member> {
    return new Member(this.client, await this.client.rest.guilds.timeout(this.guildId, this.id, durationMs, options), this.guildId);
  }

  async clearTimeout(options?: ReasonOptions): Promise<Member> {
    return new Member(this.client, await this.client.rest.guilds.clearTimeout(this.guildId, this.id, options), this.guildId);
  }

  addRole(roleId: string, options?: ReasonOptions): Promise<void> {
    return this.client.rest.guilds.addMemberRole(this.guildId, this.id, roleId, options);
  }

  removeRole(roleId: string, options?: ReasonOptions): Promise<void> {
    return this.client.rest.guilds.removeMemberRole(this.guildId, this.id, roleId, options);
  }

  async setNickname(nick: string | null, options?: ReasonOptions): Promise<Member> {
    return new Member(this.client, await this.client.rest.guilds.editMember(this.guildId, this.id, { nick }, options), this.guildId);
  }

  send(content: MessageContent, options?: MicupRequestOptions): Promise<Message> {
    if (!this.user) throw new Error('This member has no user');
    return this.user.send(content, options);
  }

  async fetch(options?: MicupRequestOptions): Promise<Member> {
    return new Member(this.client, await this.client.rest.guilds.member(this.guildId, this.id, options), this.guildId);
  }

  toString(): string {
    return this.user?.mention ?? '';
  }
}

export class Guild {
  readonly raw: MicupGuild;

  constructor(readonly client: Client, raw: MicupGuild | MicupGuildCreate) {
    this.raw = 'properties' in raw && raw.properties ? { ...raw, ...raw.properties } : raw;
  }

  get id(): string {
    return this.raw.id;
  }

  get name(): string {
    return this.raw.name ?? '';
  }

  get ownerId(): string | undefined {
    return this.raw.owner_id;
  }

  get memberCount(): number | undefined {
    return this.raw.member_count ?? this.raw.approximate_member_count;
  }

  get features(): readonly string[] {
    return this.raw.features ?? [];
  }

  get unavailable(): boolean {
    return this.raw.unavailable === true;
  }

  get createdAt(): Date {
    return snowflakeTime(this.id);
  }

  hasFeature(feature: string): boolean {
    return this.features.includes(feature);
  }

  iconURL(options?: MediaOptions): string {
    return this.client.rest.media.guildIcon(this.raw, options);
  }

  bannerURL(options?: MediaOptions): string {
    return this.client.rest.media.guildBanner(this.raw, options);
  }

  async fetch(options?: MicupRequestOptions): Promise<Guild> {
    return new Guild(this.client, await this.client.rest.guilds.get(this.id, options));
  }

  async fetchMember(userId: string, options?: MicupRequestOptions): Promise<Member> {
    return new Member(this.client, await this.client.rest.guilds.member(this.id, userId, options), this.id);
  }

  async *members(options?: MicupRequestOptions): AsyncGenerator<Member> {
    for await (const member of this.client.rest.guilds.iterateMembers(this.id, options)) yield new Member(this.client, member, this.id);
  }

  async findMembers(query: string, options?: MicupRequestOptions & { limit?: number }): Promise<Member[]> {
    const found = await this.client.rest.guilds.findMembers(this.id, query, options);
    return found.map((member) => new Member(this.client, member, this.id));
  }

  async fetchChannels(options?: MicupRequestOptions): Promise<Channel[]> {
    return (await this.client.rest.guilds.channels(this.id, options)).map((channel) => new Channel(this.client, { ...channel, guild_id: this.id }));
  }

  fetchRoles(options?: MicupRequestOptions): Promise<MicupRole[]> {
    return this.client.rest.guilds.roles(this.id, options);
  }

  kick(userId: string, options?: ReasonOptions): Promise<void> {
    return this.client.rest.guilds.kick(this.id, userId, options);
  }

  ban(userId: string, options: GuildBanInput & ReasonOptions = {}): Promise<void> {
    const { signal, reason, ...input } = options;
    return this.client.rest.guilds.ban(this.id, userId, { ...input, ...(reason !== undefined && { reason }) }, { signal, reason });
  }

  unban(userId: string, options?: ReasonOptions): Promise<void> {
    return this.client.rest.guilds.unban(this.id, userId, options);
  }

  leave(options?: MicupRequestOptions): Promise<void> {
    return this.client.rest.users.leaveGuild(this.id, options);
  }

  toString(): string {
    return this.name;
  }
}

export class Channel {
  constructor(readonly client: Client, readonly raw: MicupChannel) {}

  get id(): string {
    return this.raw.id;
  }

  get type(): number | undefined {
    return this.raw.type;
  }

  get name(): string | undefined {
    return this.raw.name;
  }

  get topic(): string | null {
    return this.raw.topic ?? null;
  }

  get guildId(): string | undefined {
    return this.raw.guild_id;
  }

  get parentId(): string | null {
    return this.raw.parent_id ?? null;
  }

  get nsfw(): boolean {
    return this.raw.nsfw === true;
  }

  get mention(): string {
    return mentionChannel(this.id);
  }

  get guild(): Guild | undefined {
    return this.guildId ? this.client.guilds.get(this.guildId) : undefined;
  }

  isText(): boolean {
    return this.type === ChannelType.GuildText || this.type === ChannelType.GuildAnnouncement || this.isThread();
  }

  isVoice(): boolean {
    return this.type === ChannelType.GuildVoice;
  }

  isDM(): boolean {
    return this.type === ChannelType.DM || this.type === ChannelType.GroupDM;
  }

  isCategory(): boolean {
    return this.type === ChannelType.GuildCategory;
  }

  isForum(): boolean {
    return this.type === ChannelType.GuildForum || this.type === ChannelType.GuildMedia;
  }

  isThread(): boolean {
    return [ChannelType.AnnouncementThread, ChannelType.PublicThread, ChannelType.PrivateThread].some((type) => type === this.type);
  }

  async send(content: MessageContent, options?: MicupRequestOptions & { replyTo?: string }): Promise<Message> {
    return new Message(this.client, await this.client.rest.sendMessage(this.id, content, options));
  }

  sendTyping(options?: MicupRequestOptions): Promise<void> {
    return this.client.rest.triggerTyping(this.id, options);
  }

  async fetch(options?: MicupRequestOptions): Promise<Channel> {
    return new Channel(this.client, await this.client.rest.channels.get(this.id, options));
  }

  async fetchMessage(messageId: string, options?: MicupRequestOptions): Promise<Message> {
    return new Message(this.client, await this.client.rest.getMessage(this.id, messageId, options));
  }

  async fetchMessages(options?: ListMessageOptions): Promise<Message[]> {
    return (await this.client.rest.listMessages(this.id, options)).map((message) => new Message(this.client, message));
  }

  async *messages(options?: Omit<ListMessageOptions, 'around' | 'limit'>): AsyncGenerator<Message> {
    for await (const message of this.client.rest.iterateMessages(this.id, options)) yield new Message(this.client, message);
  }

  bulkDelete(messages: readonly (string | { id: string })[], options?: ReasonOptions): Promise<void> {
    return this.client.rest.bulkDeleteMessages(this.id, messages.map((message) => typeof message === 'string' ? message : message.id), options);
  }

  createInvite(body: { max_age?: number; max_uses?: number; temporary?: boolean; unique?: boolean } = {}, options?: ReasonOptions): Promise<MicupInvite> {
    return this.client.rest.channels.createInvite(this.id, body, options);
  }

  async edit(changes: ChannelEdit, options?: ReasonOptions): Promise<Channel> {
    return new Channel(this.client, await this.client.rest.channels.edit(this.id, changes, options));
  }

  setTopic(topic: string | null, options?: ReasonOptions): Promise<Channel> {
    return this.edit({ topic }, options);
  }

  delete(options?: ReasonOptions): Promise<void> {
    return this.client.rest.channels.delete(this.id, options);
  }

  toString(): string {
    return this.mention;
  }
}

export class Message {
  readonly author: User;
  readonly member: Member | undefined;

  constructor(readonly client: Client, readonly raw: MicupMessage & { member?: MicupMember }) {
    this.author = new User(client, raw.author);
    this.member = raw.member && raw.guild_id ? new Member(client, { ...raw.member, user: raw.member.user ?? raw.author }, raw.guild_id) : undefined;
  }

  get id(): string {
    return this.raw.id;
  }

  get channelId(): string {
    return this.raw.channel_id;
  }

  get guildId(): string | undefined {
    return this.raw.guild_id;
  }

  get content(): string {
    return this.raw.content;
  }

  get createdAt(): Date {
    return snowflakeTime(this.id);
  }

  get editedAt(): Date | null {
    return this.raw.edited_timestamp ? new Date(this.raw.edited_timestamp) : null;
  }

  get pinned(): boolean {
    return this.raw.pinned === true;
  }

  get attachments(): readonly MessageAttachment[] {
    return this.raw.attachments ?? [];
  }

  get embeds(): readonly NonNullable<MicupMessage['embeds']>[number][] {
    return this.raw.embeds ?? [];
  }

  get mentions(): User[] {
    return (this.raw.mentions ?? []).map((user) => new User(this.client, user));
  }

  get mentionsEveryone(): boolean {
    return this.raw.mention_everyone === true;
  }

  get type(): number {
    return this.raw.type ?? MessageType.Default;
  }

  get flags(): number {
    return this.raw.flags ?? 0;
  }

  get webhookId(): string | undefined {
    return this.raw.webhook_id;
  }

  get fromWebhook(): boolean {
    return Boolean(this.raw.webhook_id);
  }

  get fromSelf(): boolean {
    return this.client.user?.id === this.author.id;
  }

  get isReply(): boolean {
    return this.type === MessageType.Reply;
  }

  get channel(): Channel {
    return this.client.channels.get(this.channelId) ?? new Channel(this.client, { id: this.channelId, ...(this.guildId && { guild_id: this.guildId }) });
  }

  get guild(): Guild | undefined {
    return this.guildId ? this.client.guilds.get(this.guildId) : undefined;
  }

  inGuild(): boolean {
    return this.guildId !== undefined;
  }

  hasFlag(flag: number): boolean {
    return (this.flags & flag) === flag;
  }

  mentionsUser(userId: string): boolean {
    return (this.raw.mentions ?? []).some((user) => user.id === userId);
  }

  async reply(content: MessageContent, options?: MicupRequestOptions): Promise<Message> {
    return new Message(this.client, await this.client.rest.sendMessage(this.channelId, content, { ...options, replyTo: this.id }));
  }

  async edit(content: MessageContent, options?: MicupRequestOptions): Promise<Message> {
    const input = typeof content === 'string' ? { content } : content;
    return new Message(this.client, await this.client.rest.editMessage(this.channelId, this.id, input, options));
  }

  delete(options?: ReasonOptions): Promise<void> {
    return this.client.rest.deleteMessage(this.channelId, this.id, options);
  }

  async fetch(options?: MicupRequestOptions): Promise<Message> {
    return new Message(this.client, await this.client.rest.getMessage(this.channelId, this.id, options));
  }

  react(emoji: string, options?: MicupRequestOptions): Promise<void> {
    return this.client.rest.channels.addReaction(this.channelId, this.id, cleanEmoji(emoji), options);
  }

  unreact(emoji: string, options?: MicupRequestOptions): Promise<void> {
    return this.client.rest.channels.removeReaction(this.channelId, this.id, cleanEmoji(emoji), options);
  }

  removeAllReactions(options?: MicupRequestOptions): Promise<void> {
    return this.client.rest.channels.deleteReaction(this.channelId, this.id, {}, options);
  }

  pin(options?: ReasonOptions): Promise<void> {
    return this.client.rest.channels.pin(this.channelId, this.id, options);
  }

  unpin(options?: ReasonOptions): Promise<void> {
    return this.client.rest.channels.unpin(this.channelId, this.id, options);
  }

  async crosspost(options?: MicupRequestOptions): Promise<Message> {
    return new Message(this.client, await this.client.rest.crosspostMessage(this.channelId, this.id, options));
  }

  async suppressEmbeds(suppress = true, options?: MicupRequestOptions): Promise<Message> {
    return new Message(this.client, await this.client.rest.suppressEmbeds(this.channelId, this.id, suppress, options));
  }

  get embedsSuppressed(): boolean {
    return this.hasFlag(MessageFlag.SuppressEmbeds);
  }

  toString(): string {
    return this.content;
  }
}

export class ReactionEvent {
  constructor(
    readonly client: Client,
    readonly raw: { user_id: string; channel_id: string; message_id: string; guild_id?: string; emoji: { id?: string | null; name: string; animated?: boolean }; member?: MicupMember },
  ) {}

  get userId(): string {
    return this.raw.user_id;
  }

  get channelId(): string {
    return this.raw.channel_id;
  }

  get messageId(): string {
    return this.raw.message_id;
  }

  get guildId(): string | undefined {
    return this.raw.guild_id;
  }

  get emoji(): { id?: string | null; name: string; animated?: boolean } {
    return this.raw.emoji;
  }

  get member(): Member | undefined {
    return this.raw.member && this.raw.guild_id ? new Member(this.client, { ...this.raw.member }, this.raw.guild_id) : undefined;
  }

  get channel(): Channel {
    return this.client.channels.get(this.channelId) ?? new Channel(this.client, { id: this.channelId, ...(this.guildId && { guild_id: this.guildId }) });
  }

  fetchMessage(options?: MicupRequestOptions): Promise<Message> {
    return this.channel.fetchMessage(this.messageId, options);
  }

  fetchUser(options?: MicupRequestOptions): Promise<User> {
    return this.client.users.fetch(this.userId, options);
  }
}
