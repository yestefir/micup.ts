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

const length = (value?: string) => value === undefined ? 0 : [...value].length;

export function validateEmbed(embed: MicupEmbed): void {
  if (length(embed.title) > 256 || length(embed.description) > 4096 || (embed.fields?.length ?? 0) > 25 ||
      (embed.color !== undefined && (!Number.isInteger(embed.color) || embed.color < 0 || embed.color > 0xffffff))) {
    throw new RangeError('Invalid Micup embed size or color');
  }
  for (const { name, value } of embed.fields ?? []) {
    if (!name || length(name) > 256 || length(value) > 1024) throw new RangeError('Invalid Micup embed field');
  }
  if (embed.author && (!embed.author.name || length(embed.author.name) > 256) ||
      embed.footer && (!embed.footer.text || length(embed.footer.text) > 2048)) {
    throw new RangeError('Invalid Micup embed author or footer');
  }
  for (const url of [embed.url, embed.image?.url, embed.thumbnail?.url]) {
    if (url && Buffer.byteLength(url) > 2048) throw new RangeError('Micup embed URL exceeds 2048 bytes');
  }
}

export class EmbedBuilder {
  readonly #embed: MicupEmbed = {};

  title(value: string): this { this.#embed.title = value; return this; }
  description(value: string): this { this.#embed.description = value; return this; }
  url(value: string): this { this.#embed.url = value; return this; }
  color(value: number): this { this.#embed.color = value; return this; }
  timestamp(value: Date): this { this.#embed.timestamp = value.toISOString(); return this; }
  author(value: NonNullable<MicupEmbed['author']>): this { this.#embed.author = { ...value }; return this; }
  footer(value: NonNullable<MicupEmbed['footer']>): this { this.#embed.footer = { ...value }; return this; }
  image(url: string): this { this.#embed.image = { url }; return this; }
  thumbnail(url: string): this { this.#embed.thumbnail = { url }; return this; }
  field(name: string, value: string, inline?: boolean): this {
    this.#embed.fields = [...(this.#embed.fields ?? []), { name, value, inline }];
    return this;
  }

  build(): MicupEmbed {
    validateEmbed(this.#embed);
    return structuredClone(this.#embed);
  }
}

export const attachmentURL = (filename: string): string => 'attachment://' + filename;
