import type { MicupMessage, MicupUser } from '../model/entities.js';
import type { AuditOptions } from './guilds.js';
import { messageBody, snowflake, type MessageInput } from './messages.js';
import type { MicupRequestOptions, RestTransport } from './transport.js';

export interface MicupWebhook {
  id: string;
  channel_id: string;
  guild_id?: string;
  type: number;
  name: string;
  avatar?: string | null;
  user?: MicupUser;
  token?: string;
}

export interface WebhookEdit {
  name?: string;
  avatar?: string | null;
  channel_id?: string;
}

export interface WebhookExecuteOptions extends MicupRequestOptions {
  wait?: boolean;
  threadId?: string;
  threadName?: string;
  appliedTags?: readonly string[];
  username?: string;
  avatarURL?: string;
}

interface WebhookMessageOptions extends MicupRequestOptions {
  threadId?: string;
}

function webhookPath(id: string, token?: string): string {
  const base = '/webhooks/' + snowflake(id, 'Webhook ID');
  if (token === undefined) return base;
  if (typeof token !== 'string' || !token.length || token === '.' || token === '..') throw new TypeError('A webhook token is required');
  return base + '/' + encodeURIComponent(token);
}

function threadQuery(threadId?: string): URLSearchParams {
  const query = new URLSearchParams();
  if (threadId !== undefined) query.set('thread_id', snowflake(threadId, 'Thread ID'));
  return query;
}

function webhookEdit(edit: WebhookEdit): WebhookEdit {
  if (edit.name !== undefined && (typeof edit.name !== 'string' || [...edit.name].length < 1 || [...edit.name].length > 80)) {
    throw new TypeError('A webhook name must contain 1 to 80 characters');
  }
  if (edit.channel_id !== undefined) snowflake(edit.channel_id, 'Channel ID');
  if (edit.name === undefined && edit.avatar === undefined && edit.channel_id === undefined) throw new TypeError('Webhook edits need a change');
  return edit;
}

export class MicupWebhooks {
  constructor(private readonly rest: RestTransport) {}

  channel(channelId: string, options?: MicupRequestOptions): Promise<MicupWebhook[]> {
    return this.rest.request('GET', '/channels/' + snowflake(channelId, 'Channel ID') + '/webhooks', options);
  }

  guild(guildId: string, options?: MicupRequestOptions): Promise<MicupWebhook[]> {
    return this.rest.request('GET', '/guilds/' + snowflake(guildId, 'Guild ID') + '/webhooks', options);
  }

  create(channelId: string, name: string, { avatar, ...options }: AuditOptions & { avatar?: string } = {}): Promise<MicupWebhook> {
    return this.rest.request('POST', '/channels/' + snowflake(channelId, 'Channel ID') + '/webhooks', {
      ...options, body: webhookEdit({ name, avatar }),
    });
  }

  get(webhookId: string, { token, signal }: MicupRequestOptions & { token?: string } = {}): Promise<MicupWebhook> {
    return this.rest.request('GET', webhookPath(webhookId, token), { signal, anonymous: token !== undefined });
  }

  edit(webhookId: string, edit: WebhookEdit, { token, ...options }: AuditOptions & { token?: string } = {}): Promise<MicupWebhook> {
    if (token !== undefined && edit.channel_id !== undefined) throw new TypeError('An authenticated bot must move the webhook');
    return this.rest.request('PATCH', webhookPath(webhookId, token), {
      ...options, body: webhookEdit(edit), anonymous: token !== undefined,
    });
  }

  delete(webhookId: string, { token, ...options }: AuditOptions & { token?: string } = {}): Promise<void> {
    return this.rest.request('DELETE', webhookPath(webhookId, token), { ...options, anonymous: token !== undefined });
  }

  execute(webhookId: string, token: string, input: string | MessageInput, options: WebhookExecuteOptions & { wait: true }): Promise<MicupMessage>;
  execute(webhookId: string, token: string, input: string | MessageInput, options?: WebhookExecuteOptions): Promise<MicupMessage | undefined>;
  execute(webhookId: string, token: string, input: string | MessageInput, options: WebhookExecuteOptions = {}): Promise<MicupMessage | undefined> {
    const { wait, threadId, threadName, appliedTags, username, avatarURL, signal } = options;
    const message = typeof input === 'string' ? { content: input } : input;
    if (message.components?.length) throw new TypeError('Webhook messages cannot carry components');
    if (!message.content && !message.embeds?.length && !message.files?.length && !message.uploads?.length && !message.sticker_ids?.length) {
      throw new TypeError('A webhook message needs content, an embed, an attachment or a sticker');
    }
    if (threadName !== undefined && (!threadName || [...threadName].length > 100 || threadId !== undefined)) {
      throw new TypeError('Choose either an existing thread or a new forum post name');
    }
    if (appliedTags?.length && (!threadName || appliedTags.length > 5)) throw new TypeError('A forum post accepts up to five tags');
    const query = threadQuery(threadId);
    if (wait) query.set('wait', 'true');
    return this.rest.request('POST', webhookPath(webhookId, token), {
      body: messageBody(message, undefined, { username, avatar_url: avatarURL, thread_name: threadName, applied_tags: appliedTags }),
      query, signal, anonymous: true, idempotent: Boolean(message.nonce),
    });
  }

  message(id: string, token: string, messageId: string, { threadId, signal }: WebhookMessageOptions = {}): Promise<MicupMessage> {
    return this.rest.request('GET', webhookPath(id, token) + '/messages/' + snowflake(messageId, 'Message ID'), {
      query: threadQuery(threadId), signal, anonymous: true,
    });
  }

  editMessage(
    id: string, token: string, messageId: string, edit: Pick<MessageInput, 'content' | 'embeds' | 'flags'>,
    { threadId, signal }: WebhookMessageOptions = {},
  ): Promise<MicupMessage> {
    const { content, embeds, flags } = edit;
    if (content === undefined && embeds === undefined && flags === undefined) throw new TypeError('Webhook message edits need a change');
    return this.rest.request('PATCH', webhookPath(id, token) + '/messages/' + snowflake(messageId, 'Message ID'), {
      query: threadQuery(threadId), signal, anonymous: true, body: { content, embeds, flags },
    });
  }

  deleteMessage(id: string, token: string, messageId: string, { threadId, signal }: WebhookMessageOptions = {}): Promise<void> {
    return this.rest.request('DELETE', webhookPath(id, token) + '/messages/' + snowflake(messageId, 'Message ID'), {
      query: threadQuery(threadId), signal, anonymous: true,
    });
  }
}
