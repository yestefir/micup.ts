export interface MicupEmbed {
  title?: string;
  description?: string;
  url?: string;
  color?: number;
  timestamp?: string;
  fields?: readonly { name: string; value: string; inline?: boolean }[];
  image?: EmbedMedia;
  thumbnail?: EmbedMedia;
  video?: EmbedMedia;
  audio?: EmbedMedia;
  footer?: { text: string; icon_url?: string; proxy_icon_url?: string };
  author?: { name: string; url?: string; icon_url?: string; proxy_icon_url?: string };
  provider?: { name: string; url?: string };
  type?: string;
  nsfw?: boolean;
  children?: readonly MicupEmbed[];
}

export interface MicupEmbedInput {
  title?: string | null;
  description?: string | null;
  url?: string | null;
  color?: number;
  timestamp?: string | null;
  fields?: readonly { name: string; value: string; inline?: boolean }[] | null;
  image?: { url: string; description?: string | null } | null;
  thumbnail?: { url: string; description?: string | null } | null;
  footer?: { text: string; icon_url?: string | null } | null;
  author?: { name: string; url?: string | null; icon_url?: string | null } | null;
}

export interface EmbedMedia {
  url: string;
  proxy_url?: string;
  width?: number;
  height?: number;
  duration?: number;
  description?: string;
  content_type?: string;
}

const length = (value?: string | null) => value == null ? 0 : [...value].length;

function assertFields(value: object, fields: readonly string[], label: string): void {
  const allowed = new Set(fields);
  for (const field of Object.keys(value)) if (!allowed.has(field)) throw new TypeError('Unsupported embed ' + label + ' field: ' + field);
}

function text(value: unknown, label: string, maximum: number, minimum = 0): void {
  if (typeof value !== 'string' || length(value) < minimum || length(value) > maximum) {
    throw new RangeError('Invalid Micup embed ' + label);
  }
}

function embedURL(value: string | null | undefined, label: string, attachment = false): void {
  if (value === undefined || value === null) return;
  if (typeof value !== 'string' || !value || Buffer.byteLength(value) > 2048) throw new RangeError('Invalid Micup embed ' + label + ' URL');
  if (attachment && value.startsWith('attachment://')) {
    if (!value.slice('attachment://'.length)) throw new TypeError('Invalid Micup embed ' + label + ' URL');
    return;
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError('Invalid Micup embed ' + label + ' URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new TypeError('Invalid Micup embed ' + label + ' URL');
}

function embedMedia(media: MicupEmbedInput['image'], label: string): void {
  if (media === undefined || media === null) return;
  if (!media || typeof media !== 'object' || Array.isArray(media)) throw new TypeError('Invalid Micup embed ' + label);
  assertFields(media, ['url', 'description'], label);
  if (typeof media.url !== 'string') throw new TypeError('Micup embed ' + label + ' needs a URL');
  embedURL(media.url, label, true);
  if (media.description !== undefined && media.description !== null) text(media.description, label + ' description', 4096, 1);
}

export function validateEmbed(embed: MicupEmbedInput): void {
  if (!embed || typeof embed !== 'object' || Array.isArray(embed)) throw new TypeError('A Micup embed must be an object');
  assertFields(embed, ['title', 'description', 'url', 'color', 'timestamp', 'fields', 'image', 'thumbnail', 'footer', 'author'], 'object');
  if (embed.title !== undefined && embed.title !== null) text(embed.title, 'title', 256);
  if (embed.description !== undefined && embed.description !== null) text(embed.description, 'description', 4096, 1);
  embedURL(embed.url, 'link');
  if (embed.timestamp !== undefined && embed.timestamp !== null &&
      (typeof embed.timestamp !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(embed.timestamp) || !Number.isFinite(Date.parse(embed.timestamp)))) {
    throw new TypeError('Invalid Micup embed timestamp');
  }
  if (embed.fields !== undefined && embed.fields !== null && !Array.isArray(embed.fields)) throw new TypeError('Micup embed fields must be an array or null');
  if ((embed.fields?.length ?? 0) > 25 ||
      (embed.color !== undefined && (!Number.isInteger(embed.color) || embed.color < 0 || embed.color > 0xffffff))) {
    throw new RangeError('Invalid Micup embed size or color');
  }
  for (const field of embed.fields ?? []) {
    if (!field || typeof field !== 'object' || Array.isArray(field)) throw new TypeError('Invalid Micup embed field');
    assertFields(field, ['name', 'value', 'inline'], 'field');
    text(field.name, 'field name', 256, 1);
    text(field.value, 'field value', 1024);
    if (field.inline !== undefined && typeof field.inline !== 'boolean') throw new TypeError('Invalid Micup embed field inline flag');
  }
  embedMedia(embed.image, 'image');
  embedMedia(embed.thumbnail, 'thumbnail');
  if (embed.author !== undefined && embed.author !== null) {
    if (!embed.author || typeof embed.author !== 'object' || Array.isArray(embed.author)) throw new TypeError('Invalid Micup embed author');
    assertFields(embed.author, ['name', 'url', 'icon_url'], 'author');
    text(embed.author.name, 'author', 256, 1);
    embedURL(embed.author.url, 'author');
    embedURL(embed.author.icon_url, 'author icon');
  }
  if (embed.footer !== undefined && embed.footer !== null) {
    if (!embed.footer || typeof embed.footer !== 'object' || Array.isArray(embed.footer)) throw new TypeError('Invalid Micup embed footer');
    assertFields(embed.footer, ['text', 'icon_url'], 'footer');
    text(embed.footer.text, 'footer', 2048, 1);
    embedURL(embed.footer.icon_url, 'footer icon');
  }
}

export class EmbedBuilder {
  readonly #embed: MicupEmbedInput = {};

  title(value: string): this { this.#embed.title = value; return this; }
  description(value: string): this { this.#embed.description = value; return this; }
  url(value: string): this { this.#embed.url = value; return this; }
  color(value: number): this { this.#embed.color = value; return this; }
  timestamp(value: Date): this { this.#embed.timestamp = value.toISOString(); return this; }
  author(value: NonNullable<MicupEmbedInput['author']>): this { this.#embed.author = { ...value }; return this; }
  footer(value: NonNullable<MicupEmbedInput['footer']>): this { this.#embed.footer = { ...value }; return this; }
  image(url: string): this { this.#embed.image = { url }; return this; }
  thumbnail(url: string): this { this.#embed.thumbnail = { url }; return this; }
  field(name: string, value: string, inline?: boolean): this {
    this.#embed.fields = [...(this.#embed.fields ?? []), { name, value, inline }];
    return this;
  }

  build(): MicupEmbedInput {
    validateEmbed(this.#embed);
    return structuredClone(this.#embed);
  }
}

export const attachmentURL = (filename: string): string => 'attachment://' + filename;
