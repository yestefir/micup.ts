import { GatewaySession, type GatewaySessionConfig, type GatewaySessionOptions } from '../session/session.js';

import { ShardManager, type ShardManagerOptions } from '../shard/manager.js';

import { MicupAPIError } from './errors.js';
import { RestTransport, type MicupRequestOptions, type RestMethod, type RestRequestOptions } from './transport.js';

import { messageBody, messageQuery, messagesPath, snowflake, type ListMessageOptions, type MessageInput } from './messages.js';

const defaultOrigin = 'https://micup.gg';
const connection = Symbol('Micup connection');

export interface MicupClientOptions {
  token: string;
  origin?: string;
  maxRestAttempts?: number;
}

export interface MicupUser {
  id: string;
  username: string;
  bot?: boolean;
}

export interface MicupMessage {
  id: string;
  channel_id: string;
  content: string;
  author: MicupUser;
}

export class MicupClient {
  readonly #token: string;
  readonly #rest: RestTransport;
  readonly #gateway?: string;
  #botId?: string;

  private constructor(key: typeof connection, token: string, api: string, gateway?: string, maxAttempts?: number) {
    if (key !== connection) {
      throw new TypeError('Use MicupClient.connect() to create a client');
    }
    this.#token = token;
    this.#rest = new RestTransport(api, token, maxAttempts);
    this.#gateway = gateway;
  }

  static async connect(
    { token, origin = defaultOrigin, maxRestAttempts }: MicupClientOptions,
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

    const discovery: { endpoints?: { api_public?: string; gateway?: string } } = await response.json();
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
    const client = new MicupClient(connection, token, `${api.href.replace(/\/+$/, '')}/v1`, gateway, maxRestAttempts);
    const user = await client.getCurrentUser({ signal });
    if (user?.bot !== true) {
      throw new Error('The credential must belong to a Micup bot');
    }
    client.#botId = user.id;
    return client;
  }

  newSession(options: GatewaySessionOptions, shard: Pick<GatewaySessionConfig, 'shardId' | 'shardCount'> = {}): GatewaySession {
    if (!this.#gateway) throw new Error('Micup discovery returned no Gateway endpoint');
    return new GatewaySession({ ...shard, endpoint: this.#gateway, token: this.#token, botId: this.#botId }, options);
  }

  newShardManager(options: ShardManagerOptions): ShardManager {
    if (!this.#gateway) throw new Error('Micup discovery returned no Gateway endpoint');
    return new ShardManager({ endpoint: this.#gateway, token: this.#token, botId: this.#botId }, options);
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
        !input?.files?.length && !input?.attachments?.length) {
      throw new TypeError('Message content, embeds, components or attachments are required');
    }
    const reply = replyTo === undefined ? undefined : { message_id: snowflake(replyTo, 'Reply message ID'), channel_id: channelId };
    return this.request('POST', path, { body: messageBody(input, reply), signal });
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

  deleteMessage(
    channelId: string, messageId: string, options?: MicupRequestOptions & { reason?: string },
  ): Promise<void> {
    return this.request('DELETE', messagesPath(channelId, messageId), options);
  }

  triggerTyping(channelId: string, options?: MicupRequestOptions): Promise<void> {
    return this.request('POST', '/channels/' + snowflake(channelId, 'Channel ID') + '/typing', options);
  }

  request<T = unknown>(method: RestMethod, path: string, options?: RestRequestOptions): Promise<T> {
    return this.#rest.request(method, path, options);
  }
}
