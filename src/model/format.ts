import type { MicupUser } from './entities.js';
import type { MicupMember } from './guild.js';

export const TimestampStyle = {
  ShortTime: 't', LongTime: 'T', ShortDate: 'd', LongDate: 'D', ShortDateTime: 'f', LongDateTime: 'F', Relative: 'R',
} as const;

export type TimestampStyle = typeof TimestampStyle[keyof typeof TimestampStyle];

export const snowflakeEpoch = 1420070400000;
const maxSnowflake = (1n << 63n) - 1n;

export function parseSnowflake(id: string): bigint {
  if (typeof id !== 'string' || !/^(?:0|[1-9]\d{0,18})$/.test(id) || BigInt(id) > maxSnowflake) {
    throw new TypeError('A snowflake must be a decimal string below 2^63');
  }
  return BigInt(id);
}

export function snowflakeTime(id: string): Date {
  return new Date(Number(parseSnowflake(id) >> 22n) + snowflakeEpoch);
}

export function snowflakeAt(at: Date): string {
  const timestamp = at.getTime();
  if (!Number.isSafeInteger(timestamp)) throw new TypeError('A valid date is required');
  const value = BigInt(Math.max(0, timestamp - snowflakeEpoch)) << 22n;
  if (value > maxSnowflake) throw new RangeError('Date exceeds the snowflake range');
  return value.toString();
}

export function compareSnowflakes(a: string, b: string): number {
  if (a.length !== b.length) return a.length < b.length ? -1 : 1;
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

export const mentionUser = (id: string): string => '<@' + id + '>';
export const mentionRole = (id: string): string => '<@&' + id + '>';
export const mentionChannel = (id: string): string => '<#' + id + '>';

export function formatTimestamp(at: Date, style?: TimestampStyle): string {
  const seconds = Math.floor(at.getTime() / 1000);
  if (!Number.isFinite(seconds)) throw new TypeError('A valid date is required');
  return '<t:' + seconds + (style ? ':' + style : '') + '>';
}

const markdownCharacters = new Set(['\\', '*', '_', '~', String.fromCharCode(96), '|', '>', '<', '[', ']', '#']);

export function escapeMarkdown(value: string): string {
  return [...value].map((character) => markdownCharacters.has(character) ? '\\' + character : character).join('');
}

export interface Emoji {
  id?: string | null;
  name: string;
  animated?: boolean;
}

export function formatEmoji(emoji: Emoji): string {
  if (!emoji.id) return emoji.name;
  return '<' + (emoji.animated ? 'a:' : ':') + emoji.name + ':' + emoji.id + '>';
}

export function reactionEmoji(emoji: Emoji): string {
  return emoji.id ? emoji.name + ':' + emoji.id : emoji.name;
}

export function userDisplayName(user: MicupUser): string {
  return user.global_name || user.username;
}

export function memberDisplayName(member: MicupMember): string {
  return member.nick || (member.user ? userDisplayName(member.user) : '');
}

export function userTag(user: MicupUser): string {
  const discriminator = user.discriminator;
  return !discriminator || discriminator === '0' || discriminator === '0000' ? user.username : user.username + '#' + discriminator;
}
