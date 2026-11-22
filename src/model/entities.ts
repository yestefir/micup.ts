import type { MicupEmbed } from './embed.js';
import type { Emoji } from './format.js';
import type { MicupChannel } from './guild.js';

export const MessageFlag = {
  Crossposted: 1 << 0,
  IsCrosspost: 1 << 1,
  SuppressEmbeds: 1 << 2,
  SourceMessageDeleted: 1 << 3,
  HasThread: 1 << 5,
  Ephemeral: 1 << 6,
  FailedToMentionSomeRolesInThread: 1 << 8,
  SuppressNotifications: 1 << 12,
  VoiceMessage: 1 << 13,
  IsComponentsV2: 1 << 15,
} as const;

export interface MicupUser {
  id: string;
  username: string;
  bot?: boolean;
  system?: boolean;
  global_name?: string | null;
  discriminator?: string;
  avatar?: string | null;
  avatar_color?: number | null;
  banner?: string | null;
  banner_color?: number | null;
  accent_color?: number | null;
  bio?: string | null;
  pronouns?: string | null;
  flags?: number;
  mention_flags?: number;
  tag_guild_id?: string | null;
}

export interface MessageAttachment {
  id: string;
  filename: string;
  url: string;
  proxy_url?: string;
  title?: string;
  description?: string | null;
  size?: number;
  content_type?: string;
  width?: number;
  height?: number;
  flags?: number;
  duration?: number;
  expires_at?: string | null;
  content_hash?: string;
  placeholder?: string;
  nsfw?: boolean;
  waveform?: string;
  expired?: boolean;
}

export interface MessageReactionCount {
  count: number;
  me?: boolean;
  emoji: Emoji;
}

export interface StickerItem {
  id: string;
  name: string;
  animated?: boolean;
}

export interface ChannelMention {
  id: string;
  name: string;
  type: number;
}

export interface MessageSnapshotContent {
  content: string;
  timestamp?: string;
  edited_timestamp?: string | null;
  mentions?: readonly string[];
  mention_roles?: readonly string[];
  mention_channels?: readonly ChannelMention[];
  embeds?: readonly MicupEmbed[];
  attachments?: readonly MessageAttachment[];
  stickers?: readonly StickerItem[];
  type?: number;
  flags?: number;
}

export interface MessageCall {
  participants: readonly string[];
  ended_timestamp?: string | null;
}

export interface MessageReference {
  type?: number;
  message_id: string;
  channel_id?: string;
  guild_id?: string;
  attachment_ids?: readonly string[];
  embed_indices?: readonly number[];
}

export interface MicupMessage {
  id: string;
  channel_id: string;
  content: string;
  author: MicupUser;
  type?: number;
  guild_id?: string;
  flags?: number;
  timestamp?: string;
  edited_timestamp?: string | null;
  pinned?: boolean;
  tts?: boolean;
  webhook_id?: string;
  mention_everyone?: boolean;
  mentions?: readonly MicupUser[];
  mention_roles?: readonly string[];
  mention_channels?: readonly ChannelMention[];
  users?: readonly MicupUser[];
  embeds?: readonly MicupEmbed[];
  attachments?: readonly MessageAttachment[];
  reactions?: readonly MessageReactionCount[];
  components?: readonly unknown[];
  stickers?: readonly StickerItem[];
  nonce?: string | number;
  message_reference?: MessageReference;
  referenced_message?: MicupMessage | null;
  message_snapshots?: readonly { message: MessageSnapshotContent }[];
  call?: MessageCall | null;
  thread?: MicupChannel | null;
}
