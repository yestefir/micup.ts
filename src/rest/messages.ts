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

function validateMentions(mentions: AllowedMentions | undefined): void {
  if (mentions === undefined) return;
  if (!mentions || typeof mentions !== 'object' || Array.isArray(mentions)) throw new TypeError('Allowed mentions must be an object');
  if (mentions.parse !== undefined) {
    if (!Array.isArray(mentions.parse)) throw new TypeError('Allowed mention parse values must be an array');
    const parsed = new Set<string>();
    for (const item of mentions.parse) {
      if (!['users', 'roles', 'everyone'].includes(item) || parsed.has(item)) {
        throw new TypeError('Allowed mention parse values must be unique supported types');
      }
      parsed.add(item);
    }
  }
  for (const [ids, label] of [[mentions.users, 'Mentioned user ID'], [mentions.roles, 'Mentioned role ID']] as const) {
    if (ids !== undefined && !Array.isArray(ids)) throw new TypeError('Allowed mention IDs must be arrays');
    for (const id of ids ?? []) snowflake(id, label);
  }
  if (mentions.replied_user !== undefined && typeof mentions.replied_user !== 'boolean') {
    throw new TypeError('Allowed mention replied_user must be a boolean');
  }
}

export function messageBody(
  { files = [], uploads = [], ...message }: MessageInput,
  reference?: MessageReference,
  extra: object = {},
): object {
  if (!Array.isArray(files) || !Array.isArray(uploads)) throw new TypeError('Message files and uploads must be arrays');
  if ((message.embeds?.length ?? 0) > 10) throw new RangeError('A Micup message accepts up to 10 embeds');
  for (const embed of message.embeds ?? []) validateEmbed(embed);
  if (message.sticker_ids !== undefined && !Array.isArray(message.sticker_ids)) throw new TypeError('Message sticker IDs must be an array');
  if ((message.sticker_ids?.length ?? 0) > 3) throw new RangeError('A Micup message accepts up to three stickers');
  for (const id of message.sticker_ids ?? []) snowflake(id, 'Sticker ID');
  const mentions = message.allowed_mentions;
  validateMentions(mentions);
  const body = {
    ...message, ...extra,
    ...(mentions && { allowed_mentions: { ...mentions, parse: mentions.parse ?? [] } }),
    ...(reference && { message_reference: reference }),
  };
  if (message.attachments !== undefined && !Array.isArray(message.attachments)) throw new TypeError('Message attachment references must be an array');
  const attachments = [...(message.attachments ?? [])];
  const attachmentIds = new Set<string>();
  for (const attachment of attachments) {
    if (!attachment || typeof attachment !== 'object') throw new TypeError('Message attachment references must be objects');
    const id = snowflake(attachment.id, 'Attachment ID');
    if (attachmentIds.has(id)) throw new TypeError('Message attachment references must have unique IDs');
    attachmentIds.add(id);
    if (attachment.filename !== undefined && typeof attachment.filename !== 'string' ||
        attachment.description !== undefined && typeof attachment.description !== 'string') {
      throw new TypeError('Message attachment metadata must be strings');
    }
  }
  if (attachments.length + files.length + uploads.length > 10) throw new RangeError('Micup messages support up to 10 attachments');
  for (const upload of uploads) {
    if (!upload || typeof upload !== 'object') throw new TypeError('Uploaded message attachments must be objects');
    assertFileName(upload.filename);
    if (typeof upload.upload_filename !== 'string' || !upload.upload_filename ||
        !Number.isSafeInteger(upload.file_size) || upload.file_size < 1 ||
        typeof upload.content_type !== 'string' || !upload.content_type ||
        upload.description !== undefined && typeof upload.description !== 'string' ||
        upload.title !== undefined && typeof upload.title !== 'string' ||
        upload.flags !== undefined && (!Number.isSafeInteger(upload.flags) || upload.flags < 0)) {
      throw new TypeError('Invalid uploaded message attachment');
    }
  }
  const newFiles = Array.from(files, (file, index) => {
    if (!file || typeof file !== 'object') throw new TypeError('Micup message files must be objects');
    const { name, data, description, title, spoiler } = file;
    assertFileName(name);
    if (!(data instanceof Blob)) throw new TypeError('Micup attachments require a Blob');
    if (description !== undefined && typeof description !== 'string' || title !== undefined && typeof title !== 'string' ||
        spoiler !== undefined && typeof spoiler !== 'boolean') throw new TypeError('Invalid Micup attachment metadata');
    return { id: index, filename: name, description, title, flags: spoiler ? 8 : undefined };
  });
  const uploadedFiles = uploads.map((upload, index) => ({ ...upload, id: files.length + index }));
  const payload = files.length || uploads.length ? { ...body, attachments: [...attachments, ...newFiles, ...uploadedFiles] } : body;
  if (files.length === 0) return payload;
  const form = new FormData();
  form.append('payload_json', JSON.stringify(payload));
  for (const [index, file] of files.entries()) form.append('files[' + index + ']', file.data, file.name);
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
