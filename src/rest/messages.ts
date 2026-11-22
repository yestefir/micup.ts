import { validateEmbed, type MicupEmbedInput } from '../model/embed.js';
export type { MicupEmbed, MicupEmbedInput } from '../model/embed.js';
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
  embeds?: readonly MicupEmbedInput[];
  components?: readonly Record<string, unknown>[];
  allowed_mentions?: AllowedMentions;
  flags?: number;
  files?: readonly MicupFile[];
  uploads?: readonly UploadedAttachment[];
  nonce?: string | number;
  enforce_nonce?: boolean;
  tts?: boolean;
  favorite_meme_id?: string | null;
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

export function validateNonce(nonce: string | number | undefined): void {
  if (nonce === undefined) return;
  if (typeof nonce === 'string') {
    if (!nonce || [...nonce].length > 32) throw new RangeError('A message nonce must contain 1 to 32 characters');
    return;
  }
  if (!Number.isSafeInteger(nonce) || nonce < 0) throw new TypeError('A numeric message nonce must be a nonnegative safe integer');
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
  for (const field of Object.keys(mentions)) {
    if (!['parse', 'users', 'roles', 'replied_user'].includes(field)) throw new TypeError('Unsupported allowed mentions field: ' + field);
  }
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
  input: MessageInput,
  reference?: MessageReference,
  extra: object = {},
): object {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('A Micup message must be an object');
  const messageFields = new Set([
    'content', 'embeds', 'components', 'allowed_mentions', 'flags', 'files', 'uploads', 'nonce', 'enforce_nonce', 'tts',
    'favorite_meme_id', 'sticker_ids', 'attachments',
  ]);
  for (const field of Object.keys(input)) if (!messageFields.has(field)) throw new TypeError('Unsupported Micup message field: ' + field);
  const { files = [], uploads = [], ...message } = input;
  if (!Array.isArray(files) || !Array.isArray(uploads)) throw new TypeError('Message files and uploads must be arrays');
  if (!extra || typeof extra !== 'object' || Array.isArray(extra)) throw new TypeError('Micup message additions must be an object');
  for (const field of Object.keys(extra)) {
    if (!['username', 'avatar_url', 'thread_name', 'applied_tags'].includes(field)) throw new TypeError('Unsupported Micup message addition: ' + field);
  }
  if (message.content !== undefined && message.content !== null && typeof message.content !== 'string') {
    throw new TypeError('Message content must be a string or null');
  }
  if (message.embeds !== undefined && !Array.isArray(message.embeds)) throw new TypeError('Message embeds must be an array');
  if ((message.embeds?.length ?? 0) > 10) throw new RangeError('A Micup message accepts up to 10 embeds');
  for (const embed of message.embeds ?? []) validateEmbed(embed);
  if (message.components !== undefined && !Array.isArray(message.components)) throw new TypeError('Message components must be an array');
  for (const component of message.components ?? []) {
    if (!component || typeof component !== 'object' || Array.isArray(component)) throw new TypeError('Message components must be objects');
  }
  if (message.flags !== undefined && (!Number.isSafeInteger(message.flags) || message.flags < 0)) {
    throw new TypeError('Message flags must be a nonnegative integer');
  }
  validateNonce(message.nonce);
  if (message.enforce_nonce !== undefined && typeof message.enforce_nonce !== 'boolean') throw new TypeError('Message enforce_nonce must be a boolean');
  if (message.tts !== undefined && typeof message.tts !== 'boolean') throw new TypeError('Message tts must be a boolean');
  if (message.favorite_meme_id !== undefined && message.favorite_meme_id !== null) snowflake(message.favorite_meme_id, 'Favorite meme ID');
  if (message.sticker_ids !== undefined && !Array.isArray(message.sticker_ids)) throw new TypeError('Message sticker IDs must be an array');
  if ((message.sticker_ids?.length ?? 0) > 3) throw new RangeError('A Micup message accepts up to three stickers');
  for (const id of message.sticker_ids ?? []) snowflake(id, 'Sticker ID');
  const mentions = message.allowed_mentions;
  validateMentions(mentions);
  const body: Record<string, unknown> = Object.fromEntries(Object.entries(message).filter(([field, value]) =>
    field !== 'attachments' && field !== 'allowed_mentions' && value !== undefined));
  Object.assign(body, extra);
  if (mentions) {
    body.allowed_mentions = {
      parse: [...(mentions.parse ?? [])],
      ...(mentions.users !== undefined && { users: [...mentions.users] }),
      ...(mentions.roles !== undefined && { roles: [...mentions.roles] }),
      ...(mentions.replied_user !== undefined && { replied_user: mentions.replied_user }),
    };
  }
  if (reference) body.message_reference = reference;
  if (message.attachments !== undefined && !Array.isArray(message.attachments)) throw new TypeError('Message attachment references must be an array');
  const attachments = [...(message.attachments ?? [])];
  const attachmentIds = new Set<string>();
  const attachmentPayload = attachments.map((attachment) => {
    if (!attachment || typeof attachment !== 'object' || Array.isArray(attachment)) throw new TypeError('Message attachment references must be objects');
    for (const field of Object.keys(attachment)) {
      if (!['id', 'filename', 'description'].includes(field)) throw new TypeError('Unsupported message attachment field: ' + field);
    }
    const id = snowflake(attachment.id, 'Attachment ID');
    if (attachmentIds.has(id)) throw new TypeError('Message attachment references must have unique IDs');
    attachmentIds.add(id);
    if (attachment.filename !== undefined && typeof attachment.filename !== 'string' ||
        attachment.description !== undefined && typeof attachment.description !== 'string') {
      throw new TypeError('Message attachment metadata must be strings');
    }
    return { id, ...(attachment.filename !== undefined && { filename: attachment.filename }),
      ...(attachment.description !== undefined && { description: attachment.description }) };
  });
  if (attachments.length + files.length + uploads.length > 10) throw new RangeError('Micup messages support up to 10 attachments');
  for (const upload of uploads) {
    if (!upload || typeof upload !== 'object' || Array.isArray(upload)) throw new TypeError('Uploaded message attachments must be objects');
    for (const field of Object.keys(upload)) {
      if (!['filename', 'upload_filename', 'file_size', 'content_type', 'description', 'title', 'flags'].includes(field)) {
        throw new TypeError('Unsupported uploaded message attachment field: ' + field);
      }
    }
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
  const uploadedFiles = uploads.map((upload, index) => ({
    id: files.length + index,
    filename: upload.filename,
    upload_filename: upload.upload_filename,
    file_size: upload.file_size,
    content_type: upload.content_type,
    ...(upload.description !== undefined && { description: upload.description }),
    ...(upload.title !== undefined && { title: upload.title }),
    ...(upload.flags !== undefined && { flags: upload.flags }),
  }));
  const payload = message.attachments !== undefined || files.length > 0 || uploads.length > 0
    ? { ...body, attachments: [...attachmentPayload, ...newFiles, ...uploadedFiles] }
    : body;
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
