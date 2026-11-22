export interface MicupFile {
  name: string;
  data: Blob;
  description?: string;
}

export interface MicupEmbed {
  title?: string;
  description?: string;
  url?: string;
  color?: number;
  timestamp?: string;
  fields?: readonly { name: string; value: string; inline?: boolean }[];
  image?: { url: string };
  thumbnail?: { url: string };
  footer?: { text: string; icon_url?: string };
  author?: { name: string; url?: string; icon_url?: string };
}

export interface AllowedMentions {
  parse?: readonly ('users' | 'roles' | 'everyone')[];
  users?: readonly string[];
  roles?: readonly string[];
  replied_user?: boolean;
}

export interface MessageInput {
  content?: string | null;
  embeds?: readonly MicupEmbed[];
  components?: readonly Record<string, unknown>[];
  allowed_mentions?: AllowedMentions;
  flags?: number;
  files?: readonly MicupFile[];
  attachments?: readonly { id: string; filename?: string; description?: string }[];
}

export interface ListMessageOptions {
  before?: string;
  after?: string;
  around?: string;
  limit?: number;
  signal?: AbortSignal;
}

export function snowflake(id: string, label: string): string {
  if (typeof id !== 'string' || !/^\d+$/.test(id)) throw new TypeError(label + ' must be a numeric string');
  return id;
}

export function messagesPath(channelId: string, messageId?: string): string {
  const base = '/channels/' + snowflake(channelId, 'Channel ID') + '/messages';
  return messageId === undefined ? base : base + '/' + snowflake(messageId, 'Message ID');
}

export function messageBody({ files = [], ...message }: MessageInput, reply?: { message_id: string; channel_id: string }): object {
  const body = { ...message, ...(reply && { message_reference: reply }) };
  if (files.length === 0) return body;
  const form = new FormData();
  const attachments = [...(body.attachments ?? []), ...files.map(({ name, data, description }, index) => {
    if (!name || /[/\\\r\n\u0000]/.test(name) || !(data instanceof Blob)) {
      throw new TypeError('Micup attachments require a filename and a Blob');
    }
    return { id: index, filename: name, description };
  })];
  if (attachments.length > 10) throw new RangeError('Micup messages support up to 10 attachments');
  form.append('payload_json', JSON.stringify({ ...body, attachments }));
  files.forEach(({ name, data }, index) => form.append('files[' + index + ']', data, name));
  return form;
}

export function messageQuery({ before, after, around, limit }: ListMessageOptions): URLSearchParams {
  const entries = Object.entries({ before, after, around }).filter((entry): entry is [string, string] => entry[1] !== undefined);
  if (entries.length > 1) throw new TypeError('Only one message cursor can be used at a time');
  const query = new URLSearchParams(entries.map(([name, value]) => [name, snowflake(value, name)]));
  if (limit !== undefined) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new RangeError('Message limit must be between 1 and 100');
    query.set('limit', String(limit));
  }
  return query;
}
