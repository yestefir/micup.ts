import { GatewaySession, type GatewaySessionConfig, type GatewaySessionOptions } from '../session/session.js';

import { ShardManager, type ShardManagerOptions } from '../shard/manager.js';

import { MicupAPIError } from '../rest/errors.js';
import { RestTransport, type MicupLogger, type MicupRequestOptions, type RestMethod, type RestRequestOptions } from '../rest/transport.js';
import { tokenId } from '../rest/identity.js';
import { MessageFlag } from '../model/entities.js';
import type { MicupApplication } from '../rest/users.js';

import { messageBody, messageQuery, messagesPath, snowflake, type ListMessageOptions, type MessageForward, type MessageInput, type MessageSearch, type MessageSearchResult } from '../rest/messages.js';

import { MicupCommands } from '../rest/commands.js';
import { MicupInteractions } from '../rest/interactions.js';

import { MicupGuilds } from '../rest/guilds.js';
import { MicupChannels } from '../rest/channels.js';

import type { MicupMessage, MicupUser } from '../model/entities.js';
import { MicupAttachments } from '../rest/attachments.js';
import { MicupWebhooks } from '../rest/webhooks.js';

import { MicupUsers } from '../rest/users.js';

import { MicupExpressions } from '../rest/expressions.js';
import { MicupSounds } from '../rest/sounds.js';
import { MicupDiscovery } from '../rest/discovery.js';
import { MicupVoiceRooms } from '../rest/rooms.js';

import { discoverPublicBase, MicupMedia } from '../model/media.js';

const defaultOrigin = 'https://micup.gg';
const connection = Symbol('Micup connection');

export interface MicupClientOptions {
  token: string;
  origin?: string;
  maxRestAttempts?: number;
  logger?: MicupLogger;
  rejectedRequestLimit?: number;
}

export class MicupClient {
  readonly #token: string;
  readonly #rest: RestTransport;
  readonly #gateway?: string;
  #botId?: string;
  #self?: MicupUser;
  #application?: Promise<MicupApplication>;
  #commands?: MicupCommands;
  readonly interactions: MicupInteractions;
  readonly guilds: MicupGuilds;
  readonly channels: MicupChannels;
  readonly attachments: MicupAttachments;
  readonly webhooks: MicupWebhooks;
  readonly users: MicupUsers;
  readonly expressions: MicupExpressions;
  readonly sounds: MicupSounds;
  readonly discovery: MicupDiscovery;
  readonly rooms: MicupVoiceRooms;
  readonly media: MicupMedia;
  readonly inviteBase: string;
  readonly #origin: string;

  private constructor(key: typeof connection, token: string, api: string, endpoints: { gateway?: string; media?: string; invite?: string }, maxAttempts?: number, logger?: MicupLogger, rejectionLimit?: number) {
    if (key !== connection) {
      throw new TypeError('Use MicupClient.connect() to create a client');
    }
    this.#token = token;
    this.#rest = new RestTransport(api, token, maxAttempts, logger, rejectionLimit);
    this.interactions = new MicupInteractions(this.#rest);
    this.guilds = new MicupGuilds(this.#rest);
    this.channels = new MicupChannels(this.#rest);
    this.attachments = new MicupAttachments(this.#rest);
    this.webhooks = new MicupWebhooks(this.#rest);
    this.users = new MicupUsers(this.#rest);
    this.expressions = new MicupExpressions(this.#rest);
    this.sounds = new MicupSounds(this.#rest);
    this.discovery = new MicupDiscovery(this.#rest);
    this.rooms = new MicupVoiceRooms(this.#rest);
    this.#gateway = endpoints.gateway;
    this.#origin = new URL(api).origin;
    this.media = new MicupMedia(endpoints.media ?? '');
    this.inviteBase = discoverPublicBase(endpoints.invite);
  }

  static async connect(
    { token, origin = defaultOrigin, maxRestAttempts, logger, rejectedRequestLimit }: MicupClientOptions,
    { signal }: MicupRequestOptions = {},
  ): Promise<MicupClient> {
    if (typeof token !== 'string' || !/^[\x21-\x7E]+$/.test(token)) {
      throw new TypeError('A valid Micup bot token is required');
    }

    const url = new URL(origin);
    if (url.protocol !== 'https:' || url.username || url.password ||
        url.pathname !== '/' || url.search || url.hash) {
      throw new TypeError('Micup origin must be an HTTPS origin');
    }

    const response = await fetch(new URL('/.well-known/fluxer', url), {
      redirect: 'error',
      signal,
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new MicupAPIError(response);
    }

    const discovery: { endpoints?: { api_public?: string; gateway?: string; media?: string; invite?: string } } = await response.json();
    const endpoint = discovery?.endpoints?.api_public;
    if (typeof endpoint !== 'string') {
      throw new Error('Micup discovery returned no API endpoint');
    }
    const api = new URL(endpoint);
    if (api.origin !== url.origin || api.username || api.password || api.search || api.hash) {
      throw new Error('Micup discovery returned an invalid API endpoint');
    }

    const gateway = discovery.endpoints?.gateway;
    if (gateway !== undefined) {
      if (typeof gateway !== 'string') throw new Error('Micup discovery returned an invalid Gateway endpoint');
      const endpoint = new URL(gateway);
      if (endpoint.protocol !== 'wss:' || endpoint.host !== url.host || endpoint.username ||
          endpoint.password || endpoint.hash) {
        throw new Error('Micup discovery returned an invalid Gateway endpoint');
      }
    }
    const client = new MicupClient(connection, token, `${api.href.replace(/\/+$/, '')}/v1`, { ...discovery.endpoints, gateway }, maxRestAttempts, logger, rejectedRequestLimit);
    const user = await client.getCurrentUser({ signal });
    if (user?.bot !== true) {
      throw new Error('The credential must belong to a Micup bot');
    }
    client.#botId = user.id;
    client.#self = user;
    return client;
  }

  get self(): MicupUser {
    if (!this.#self) throw new Error('Micup did not return the bot user');
    return this.#self;
  }

  get tokenId(): string | undefined {
    return tokenId(this.#token);
  }

  application(options?: MicupRequestOptions): Promise<MicupApplication> {
    if (!this.#application) {
      this.#application = this.users.application(options);
      this.#application.catch(() => { this.#application = undefined; });
    }
    return this.#application;
  }

  async applicationId(options?: MicupRequestOptions): Promise<string> {
    try {
      return (await this.application(options)).id;
    } catch (error) {
      options?.signal?.throwIfAborted();
      if (!this.#botId) throw error;
      return this.#botId;
    }
  }

  get commands(): MicupCommands {
    if (!this.#botId) throw new Error('Micup did not return the bot ID');
    return this.#commands ??= new MicupCommands(this.#rest, this.#botId);
  }

  newSession(options: GatewaySessionOptions, shard: Pick<GatewaySessionConfig, 'shardId' | 'shardCount'> = {}): GatewaySession {
    if (!this.#gateway) throw new Error('Micup discovery returned no Gateway endpoint');
    return new GatewaySession({ ...shard, endpoint: this.#gateway, token: this.#token, botId: this.#botId, lookupChannel: this.channels.get.bind(this.channels), lookupMembers: this.guilds.members.bind(this.guilds) }, options);
  }

  newShardManager(options: ShardManagerOptions): ShardManager {
    if (!this.#gateway) throw new Error('Micup discovery returned no Gateway endpoint');
    return new ShardManager({ endpoint: this.#gateway, token: this.#token, botId: this.#botId, lookupChannel: this.channels.get.bind(this.channels), lookupMembers: this.guilds.members.bind(this.guilds) }, options);
  }

  gateway(options: GatewaySessionOptions, runOptions?: { signal?: AbortSignal }): Promise<void> {
    return this.newSession(options).runOnce(runOptions);
  }

  async recommendedShards(options?: MicupRequestOptions): Promise<number> {
    let count = 0;
    for await (const guild of this.users.iterateGuilds(options)) {
      if (guild.id) count++;
    }
    let recommended = 0;
    try {
      const info = await this.request<{ shards: number }>('GET', '/gateway/bot', options);
      if (Number.isSafeInteger(info?.shards)) recommended = info.shards;
    } catch {
      options?.signal?.throwIfAborted();
    }
    return Math.max(1, Math.ceil(count / 2000), recommended);
  }

  botInviteURL({ scopes = ['bot'], permissions, guildId }: { scopes?: readonly string[]; permissions?: bigint; guildId?: string } = {}): string {
    if (!this.#botId) throw new Error('Micup did not return the bot ID');
    if (!scopes.length || scopes.some((scope) => !scope || /\s/.test(scope))) throw new TypeError('OAuth scopes must be nonempty words');
    if (permissions !== undefined && (typeof permissions !== 'bigint' || permissions < 0n)) throw new TypeError('Invalid OAuth permissions');
    const url = new URL('/oauth2/authorize', this.#origin);
    url.searchParams.set('client_id', this.#botId);
    url.searchParams.set('scope', scopes.join(' '));
    if (permissions) url.searchParams.set('permissions', String(permissions));
    if (guildId !== undefined) url.searchParams.set('guild_id', snowflake(guildId, 'Guild ID'));
    return url.href;
  }

  getCurrentUser({ signal }: MicupRequestOptions = {}): Promise<MicupUser> {
    return this.request('GET', '/users/@me', { signal });
  }

  sendMessage(
    channelId: string,
    content: string | MessageInput,
    { replyTo, signal }: MicupRequestOptions & { replyTo?: string } = {},
  ): Promise<MicupMessage> {
    const path = messagesPath(channelId);
    const input = typeof content === 'string' ? { content } : content;
    if (!input?.content?.trim() && !input?.embeds?.length && !input?.components?.length &&
        !input?.files?.length && !input?.attachments?.length && !input?.uploads?.length && !input?.sticker_ids?.length) {
      throw new TypeError('Message content, embeds, components or attachments are required');
    }
    const reply = replyTo === undefined ? undefined : { message_id: snowflake(replyTo, 'Reply message ID'), channel_id: channelId };
    return this.request('POST', path, { body: messageBody(input, reply), signal, idempotent: Boolean(input.nonce && input.enforce_nonce) });
  }

  getMessage(channelId: string, messageId: string, options?: MicupRequestOptions): Promise<MicupMessage> {
    return this.request('GET', messagesPath(channelId, messageId), options);
  }

  listMessages(channelId: string, options: ListMessageOptions = {}): Promise<MicupMessage[]> {
    return this.request('GET', messagesPath(channelId), { query: messageQuery(options), signal: options.signal });
  }

  async *iterateMessages(channelId: string, options: Omit<ListMessageOptions, 'around' | 'limit'> = {}): AsyncGenerator<MicupMessage> {
    if (options.before !== undefined && options.after !== undefined) throw new TypeError('Only one message cursor can be used');
    let cursor = options.after ?? options.before;
    const forward = options.after !== undefined;
    while (true) {
      const page = await this.listMessages(channelId, {
        ...(forward ? { after: cursor } : { before: cursor }), limit: 100, signal: options.signal,
      });
      if (!page.length) return;
      page.sort((a, b) => {
        const x = BigInt(a.id);
        const y = BigInt(b.id);
        if (x === y) return 0;
        return (x < y) === forward ? -1 : 1;
      });
      for (const message of page) {
        if (cursor === undefined || (forward ? BigInt(message.id) > BigInt(cursor) : BigInt(message.id) < BigInt(cursor))) {
          yield message;
        }
      }
      const next = page.at(-1)!.id;
      if (page.length < 100 || next === cursor || (cursor !== undefined && (forward ? BigInt(next) <= BigInt(cursor) : BigInt(next) >= BigInt(cursor)))) return;
      cursor = next;
    }
  }

  editMessage(
    channelId: string, messageId: string, edit: MessageInput, options?: MicupRequestOptions,
  ): Promise<MicupMessage> {
    return this.request('PATCH', messagesPath(channelId, messageId), { ...options, body: messageBody(edit) });
  }

  async suppressEmbeds(channelId: string, messageId: string, suppress = true, options?: MicupRequestOptions): Promise<MicupMessage> {
    const current = await this.getMessage(channelId, messageId, options);
    const settable = MessageFlag.SuppressEmbeds | MessageFlag.SuppressNotifications | MessageFlag.VoiceMessage;
    const kept = (current.flags ?? 0) & settable & ~MessageFlag.SuppressEmbeds;
    return this.editMessage(channelId, messageId, { flags: suppress ? kept | MessageFlag.SuppressEmbeds : kept }, options);
  }

  deleteMessage(
    channelId: string, messageId: string, options?: MicupRequestOptions & { reason?: string },
  ): Promise<void> {
    return this.request('DELETE', messagesPath(channelId, messageId), options);
  }

  triggerTyping(channelId: string, options?: MicupRequestOptions): Promise<void> {
    return this.request('POST', '/channels/' + snowflake(channelId, 'Channel ID') + '/typing', options);
  }

  async sendDM(userId: string, message: string | MessageInput, options?: MicupRequestOptions): Promise<MicupMessage> {
    const channel = await this.users.createDM(userId, options);
    return this.sendMessage(channel.id, message, options);
  }

  forwardMessage(
    channelId: string, forward: MessageForward,
    { signal, nonce, flags }: MicupRequestOptions & Pick<MessageInput, 'nonce' | 'flags'> = {},
  ): Promise<MicupMessage> {
    if ((forward.attachment_ids?.length ?? 0) > 10 || (forward.embed_indices?.length ?? 0) > 10 ||
        forward.embed_indices?.some((index) => !Number.isSafeInteger(index) || index < 0)) {
      throw new RangeError('Invalid Micup forward attachment or embed selection');
    }
    const reference = {
      type: 1,
      channel_id: snowflake(forward.channel_id, 'Source channel ID'),
      message_id: snowflake(forward.message_id, 'Source message ID'),
      guild_id: forward.guild_id === undefined ? undefined : snowflake(forward.guild_id, 'Source guild ID'),
      attachment_ids: forward.attachment_ids?.map((id) => snowflake(id, 'Attachment ID')),
      embed_indices: forward.embed_indices,
    };
    return this.request('POST', messagesPath(channelId), {
      body: { message_reference: reference, nonce, flags }, signal, idempotent: Boolean(nonce),
    });
  }

  crosspostMessage(channelId: string, messageId: string, options?: MicupRequestOptions): Promise<MicupMessage> {
    return this.request('POST', messagesPath(channelId, messageId) + '/crosspost', options);
  }

  bulkDeleteMessages(channelId: string, messageIds: readonly string[], options?: MicupRequestOptions & { reason?: string }): Promise<void> {
    const ids = [...new Set(messageIds.map((id) => snowflake(id, 'Message ID')))];
    if (!ids.length || ids.length > 100) throw new RangeError('Bulk deletion takes 1 to 100 unique message IDs');
    return this.request('POST', messagesPath(channelId) + '/bulk-delete', { ...options, body: { message_ids: ids } });
  }

  deleteAttachment(channelId: string, messageId: string, attachmentId: string, options?: MicupRequestOptions): Promise<void> {
    return this.request('DELETE', messagesPath(channelId, messageId) + '/attachments/' + snowflake(attachmentId, 'Attachment ID'), options);
  }

  searchMessages(search: MessageSearch, options?: MicupRequestOptions): Promise<MessageSearchResult> {
    if (search.context_guild_id === undefined && search.context_channel_id === undefined) {
      throw new TypeError('A Micup message search needs a guild ID or a channel ID');
    }
    if (search.context_guild_id !== undefined) snowflake(search.context_guild_id, 'Guild ID');
    if (search.context_channel_id !== undefined) snowflake(search.context_channel_id, 'Channel ID');
    if (search.page !== undefined && (!Number.isSafeInteger(search.page) || search.page < 1 || search.page > 400) ||
        search.hits_per_page !== undefined && (!Number.isSafeInteger(search.hits_per_page) || search.hits_per_page < 1 || search.hits_per_page > 25)) {
      throw new RangeError('Micup search takes 1 to 25 hits per page and up to 400 pages');
    }
    return this.request('POST', '/search/messages', { ...options, body: search, idempotent: true });
  }

  request<T = unknown>(method: RestMethod, path: string, options?: RestRequestOptions): Promise<T> {
    return this.#rest.request(method, path, options);
  }
}
