const defaultOrigin = 'https://micup.gg';
const connection = Symbol('Micup connection');

export interface MicupClientOptions {
  token: string;
  origin?: string;
}

export interface MicupRequestOptions {
  signal?: AbortSignal;
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

interface APIErrorBody {
  message?: string;
  code?: string;
}

export class MicupAPIError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly retryAfter: string | null;

  constructor(response: Response, body?: APIErrorBody) {
    super(body?.message ?? `Micup API returned HTTP ${response.status}`);
    this.name = 'MicupAPIError';
    this.status = response.status;
    this.code = body?.code;
    this.retryAfter = response.headers.get('retry-after');
  }
}

export class MicupClient {
  readonly #token: string;
  readonly #api: string;

  private constructor(key: typeof connection, token: string, api: string) {
    if (key !== connection) {
      throw new TypeError('Use MicupClient.connect() to create a client');
    }
    this.#token = token;
    this.#api = api;
  }

  static async connect(
    { token, origin = defaultOrigin }: MicupClientOptions,
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

    const discovery: { endpoints?: { api_public?: string } } = await response.json();
    const endpoint = discovery?.endpoints?.api_public;
    if (typeof endpoint !== 'string') {
      throw new Error('Micup discovery returned no API endpoint');
    }
    const api = new URL(endpoint);
    if (api.origin !== url.origin || api.username || api.password || api.search || api.hash) {
      throw new Error('Micup discovery returned an invalid API endpoint');
    }

    const client = new MicupClient(connection, token, `${api.href.replace(/\/+$/, '')}/v1`);
    const user = await client.getCurrentUser({ signal });
    if (user?.bot !== true) {
      throw new Error('The credential must belong to a Micup bot');
    }
    return client;
  }

  getCurrentUser({ signal }: MicupRequestOptions = {}): Promise<MicupUser> {
    return this.#request('GET', '/users/@me', { signal });
  }

  sendMessage(
    channelId: string,
    content: string,
    { replyTo, signal }: MicupRequestOptions & { replyTo?: string } = {},
  ): Promise<MicupMessage> {
    if (typeof channelId !== 'string' || !/^\d+$/.test(channelId)) {
      throw new TypeError('Channel ID must be a numeric string');
    }
    if (typeof content !== 'string' || !content.trim()) {
      throw new TypeError('Message content is required');
    }
    const body: { content: string; message_reference?: { message_id: string; channel_id: string } } = { content };
    if (replyTo !== undefined) {
      if (typeof replyTo !== 'string' || !/^\d+$/.test(replyTo)) {
        throw new TypeError('Reply message ID must be a numeric string');
      }
      body.message_reference = { message_id: replyTo, channel_id: channelId };
    }
    return this.#request('POST', `/channels/${channelId}/messages`, { body, signal });
  }

  async #request<T>(
    method: string,
    path: string,
    { body, signal }: MicupRequestOptions & { body?: object },
  ): Promise<T> {
    const headers = new Headers({ Authorization: `Bot ${this.#token}` });
    if (body !== undefined) {
      headers.set('Content-Type', 'application/json');
    }

    const response = await fetch(`${this.#api}${path}`, {
      method,
      headers,
      body: JSON.stringify(body),
      redirect: 'error',
      signal,
    });
    if (!response.ok) {
      const error = await response.json().catch(() => undefined);
      throw new MicupAPIError(response, error);
    }
    return response.json();
  }
}
