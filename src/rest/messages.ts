import { validateEmbed, type MicupEmbed } from '../model/embed.js';
export type { MicupEmbed } from '../model/embed.js';
import type { MessageReference } from '../model/entities.js';
import type { UploadedAttachment } from './attachments.js';

export interface MicupFile {
  name: string;
  data: Blob;
  description?: string;
  title?: string;
  spoiler?: boolean;
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
  uploads?: readonly UploadedAttachment[];
  nonce?: string;
  enforce_nonce?: boolean;
  tts?: boolean;
  sticker_ids?: readonly string[];
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

export function assertFileName(name: string): void {
  if (typeof name !== 'string' || !name || /[/\\\r\n\u0000]/.test(name)) {
    throw new TypeError('Micup attachments require a valid filename');
  }
}

export function messageBody(
  { files = [], uploads = [], ...message }: MessageInput,
  reference?: MessageReference,
  extra: object = {},
): object {
  if ((message.embeds?.length ?? 0) > 10) throw new RangeError('A Micup message accepts up to 10 embeds');
  for (const embed of message.embeds ?? []) validateEmbed(embed);
  if ((message.sticker_ids?.length ?? 0) > 3) throw new RangeError('A Micup message accepts up to three stickers');
  const mentions = message.allowed_mentions;
  const body = {
    ...message, ...extra,
    ...(mentions && { allowed_mentions: { ...mentions, parse: mentions.parse ?? [] } }),
    ...(reference && { message_reference: reference }),
  };
  const attachments = [...(message.attachments ?? [])];
  if (attachments.length + files.length + uploads.length > 10) throw new RangeError('Micup messages support up to 10 attachments');
  const newFiles = files.map(({ name, data, description, title, spoiler }, index) => {
    assertFileName(name);
    if (!(data instanceof Blob)) throw new TypeError('Micup attachments require a Blob');
    return { id: index, filename: name, description, title, flags: spoiler ? 8 : undefined };
  });
  const uploadedFiles = uploads.map((upload, index) => ({ ...upload, id: files.length + index }));
  const payload = files.length || uploads.length ? { ...body, attachments: [...attachments, ...newFiles, ...uploadedFiles] } : body;
  if (files.length === 0) return payload;
  const form = new FormData();
  form.append('payload_json', JSON.stringify(payload));
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

export interface MessageForward {
  channel_id: string;
  message_id: string;
  guild_id?: string;
  attachment_ids?: readonly string[];
  embed_indices?: readonly number[];
}

export interface MessageSearch {
  context_guild_id?: string;
  context_channel_id?: string;
  content?: string;
  min_id?: string;
  max_id?: string;
  channel_ids?: readonly string[];
  exclude_channel_id?: readonly string[];
  exact_phrases?: readonly string[];
  author_id?: readonly string[];
  exclude_author_id?: readonly string[];
  author_type?: readonly ('user' | 'bot' | 'webhook')[];
  mentions?: readonly string[];
  has?: readonly string[];
  exclude_has?: readonly string[];
  link_hostname?: readonly string[];
  attachment_filename?: readonly string[];
  attachment_extension?: readonly string[];
  mention_everyone?: boolean;
  pinned?: boolean;
  include_nsfw?: boolean;
  hits_per_page?: number;
  page?: number;
  sort_by?: 'timestamp' | 'relevance';
  sort_order?: 'asc' | 'desc';
}

export interface MessageSearchResult {
  messages: import('../model/entities.js').MicupMessage[];
  channels?: import('../model/guild.js').MicupChannel[];
  threads?: import('../model/guild.js').MicupChannel[];
  total: number;
  hits_per_page: number;
  page: number;
  indexing?: boolean;
}
