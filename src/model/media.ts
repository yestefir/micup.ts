import type { MicupUser } from './entities.js';
import type { Emoji } from './format.js';
import type { MicupGuild, MicupMember, MicupRole } from './guild.js';

export interface MediaOptions {
  format?: 'png' | 'jpg' | 'webp' | 'gif' | 'avif';
  size?: number;
}

export function discoverPublicBase(value: unknown): string {
  if (typeof value !== 'string' || !URL.canParse(value)) return '';
  const url = new URL(value);
  return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash
    ? url.href.replace(/\/+$/, '') : '';
}

export class MicupMedia {
  readonly base: string;

  constructor(base: string) {
    this.base = discoverPublicBase(base);
  }

  userAvatar(user: MicupUser, options?: MediaOptions): string {
    return this.#image(['avatars', user.id], user.avatar, options);
  }

  userBanner(user: MicupUser, options?: MediaOptions): string {
    return this.#image(['banners', user.id], user.banner, options);
  }

  memberAvatar(guildId: string, member: MicupMember, options?: MediaOptions): string {
    if (!member.user) return '';
    return member.avatar ? this.#image(['guilds', guildId, 'users', member.user.id, 'avatars'], member.avatar, options)
      : this.userAvatar(member.user, options);
  }

  guildIcon(guild: MicupGuild, options?: MediaOptions): string {
    return this.#image(['icons', guild.id], guild.icon, options);
  }

  guildBanner(guild: MicupGuild, options?: MediaOptions): string {
    return this.#image(['banners', guild.id], guild.banner, options);
  }

  guildSplash(guild: MicupGuild, options?: MediaOptions): string {
    return this.#image(['splashes', guild.id], guild.splash, options);
  }

  roleIcon(role: MicupRole, options?: MediaOptions): string {
    return this.#image(['role-icons', role.id], role.icon, options);
  }

  emojiImage(emoji: Emoji, options?: MediaOptions): string {
    return this.#image(['emojis'], emoji.id, options, emoji.animated);
  }

  stickerImage(stickerId: string, options?: MediaOptions): string {
    return this.#image(['stickers'], stickerId, options);
  }

  #image(parts: readonly string[], value?: string | null, { format, size }: MediaOptions = {}, animated = value?.startsWith('a_')): string {
    if (!this.base || !value) return '';
    if (format !== undefined && !['png', 'jpg', 'webp', 'gif', 'avif'].includes(format)) throw new TypeError('Invalid Micup image format');
    const query = new URLSearchParams();
    if (animated && (format === 'png' || format === 'jpg')) query.set('animated', 'false');
    if (size !== undefined) {
      if (!Number.isSafeInteger(size) || size < 1) throw new TypeError('A Micup image size must be a positive integer');
      query.set('size', String(size));
    }
    const path = [...parts, value].map(encodeURIComponent).join('/');
    return this.base + '/' + path + '.' + (format ?? 'webp') + (query.size ? '?' + query : '');
  }
}

export function inviteURL(base: string, code: string): string {
  const prefix = discoverPublicBase(base);
  if (!prefix || !code || code === '.' || code === '..') throw new TypeError('An invite base URL and code are required');
  return prefix + '/' + encodeURIComponent(code);
}
