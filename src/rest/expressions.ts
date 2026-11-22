import type { Emoji } from '../model/format.js';
import type { AuditOptions } from './guilds.js';
import { guildPath } from './guilds.js';
import { snowflake } from './messages.js';
import type { MicupRequestOptions, RestTransport } from './transport.js';

export interface EmojiInput {
  name: string;
  image: string;
}

export interface StickerInput {
  name: string;
  image: string;
  description?: string;
  tags?: readonly string[];
}

export interface MicupSticker {
  id: string;
  name: string;
  description?: string;
  tags?: string[];
  format_type?: number;
}

export interface ExpressionMetadata {
  id: string;
  guild_id: string;
  name: string;
  animated: boolean;
  allow_cloning: boolean;
}

export interface ExpressionSourceGuild {
  id: string;
  name: string;
  icon: string | null;
  features: string[];
}

export interface ExpressionBulkResult<T> {
  success: T[];
  failed: { name?: string; error?: string; index?: number }[];
}

function emojiName(name: string): void {
  if (!/^[A-Za-z0-9_]{2,32}$/.test(name)) throw new TypeError('Emoji names need 2 to 32 ASCII letters, digits or underscores');
}

function stickerText({ name, description, tags }: Omit<StickerInput, 'image'>): void {
  if (![...name].length || [...name].length < 2 || [...name].length > 30 ||
      (description !== undefined && [...description].length > 500) ||
      (tags !== undefined && (tags.length > 10 || tags.some((tag) => !tag || [...tag].length > 30)))) {
    throw new TypeError('Invalid Micup sticker name, description or tags');
  }
}

function createEmoji(item: EmojiInput): void {
  emojiName(item.name);
  if (!item.image) throw new TypeError('An emoji image is required');
}

function createSticker(item: StickerInput): void {
  stickerText(item);
  if (!item.image) throw new TypeError('A sticker image is required');
}

type Resource = 'emojis' | 'stickers';

export class MicupExpressions {
  constructor(private readonly rest: RestTransport) {}

  #path(guildId: string, kind: Resource, id?: string): string {
    const base = guildPath(guildId) + '/' + kind;
    return id === undefined ? base : base + '/' + snowflake(id, 'Expression ID');
  }

  listEmojis(guildId: string, options?: MicupRequestOptions): Promise<Emoji[]> {
    return this.rest.request('GET', this.#path(guildId, 'emojis'), options);
  }

  listStickers(guildId: string, options?: MicupRequestOptions): Promise<MicupSticker[]> {
    return this.rest.request('GET', this.#path(guildId, 'stickers'), options);
  }

  createEmoji(guildId: string, body: EmojiInput, options?: AuditOptions): Promise<Emoji> {
    createEmoji(body);
    return this.rest.request('POST', this.#path(guildId, 'emojis'), { ...options, body });
  }

  createSticker(guildId: string, body: StickerInput, options?: AuditOptions): Promise<MicupSticker> {
    createSticker(body);
    return this.rest.request('POST', this.#path(guildId, 'stickers'), { ...options, body });
  }

  createEmojis(guildId: string, emojis: readonly EmojiInput[], options?: AuditOptions): Promise<ExpressionBulkResult<Emoji>> {
    if (!emojis.length || emojis.length > 50) throw new RangeError('A bulk create takes up to 50 emojis');
    emojis.forEach(createEmoji);
    return this.rest.request('POST', this.#path(guildId, 'emojis') + '/bulk', { ...options, body: { emojis } });
  }

  createStickers(guildId: string, stickers: readonly StickerInput[], options?: AuditOptions): Promise<ExpressionBulkResult<MicupSticker>> {
    if (!stickers.length || stickers.length > 50) throw new RangeError('A bulk create takes up to 50 stickers');
    stickers.forEach(createSticker);
    return this.rest.request('POST', this.#path(guildId, 'stickers') + '/bulk', { ...options, body: { stickers } });
  }

  cloneEmoji(guildId: string, source: string, options?: AuditOptions): Promise<Emoji> {
    return this.rest.request('POST', this.#path(guildId, 'emojis') + '/clone', { ...options, body: { source_emoji_id: snowflake(source, 'Source emoji ID') } });
  }

  cloneSticker(guildId: string, source: string, options?: AuditOptions): Promise<MicupSticker> {
    return this.rest.request('POST', this.#path(guildId, 'stickers') + '/clone', { ...options, body: { source_sticker_id: snowflake(source, 'Source sticker ID') } });
  }

  renameEmoji(guildId: string, id: string, name: string, options?: AuditOptions): Promise<Emoji> {
    emojiName(name);
    return this.rest.request('PATCH', this.#path(guildId, 'emojis', id), { ...options, body: { name } });
  }

  editSticker(guildId: string, id: string, body: Omit<StickerInput, 'image'>, options?: AuditOptions): Promise<MicupSticker> {
    stickerText(body);
    return this.rest.request('PATCH', this.#path(guildId, 'stickers', id), { ...options, body: { tags: [], ...body } });
  }

  delete(guildId: string, kind: Resource, id: string, { purge, ...options }: AuditOptions & { purge?: boolean } = {}): Promise<void> {
    const query = purge ? new URLSearchParams({ purge: 'true' }) : undefined;
    return this.rest.request('DELETE', this.#path(guildId, kind, id), { ...options, query });
  }

  emoji(guildId: string, id: string, options?: MicupRequestOptions): Promise<Emoji> {
    return this.rest.request('GET', this.#path(guildId, 'emojis', id), options);
  }

  sticker(guildId: string, id: string, options?: MicupRequestOptions): Promise<MicupSticker> {
    return this.rest.request('GET', this.#path(guildId, 'stickers', id), options);
  }

  source(kind: Resource, id: string, options?: MicupRequestOptions): Promise<ExpressionSourceGuild> {
    return this.rest.request('GET', '/' + kind + '/' + snowflake(id, 'Expression ID') + '/source', options);
  }

  metadata(kind: Resource, id: string, options?: MicupRequestOptions): Promise<ExpressionMetadata> {
    return this.rest.request('GET', '/' + kind + '/' + snowflake(id, 'Expression ID') + '/metadata', options);
  }
}
