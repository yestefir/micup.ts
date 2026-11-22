import type { MicupUser } from './entities.js';

export interface PermissionOverwrite {
  id: string;
  type: number;
  allow: string | number;
  deny: string | number;
}

export interface MicupRole {
  id: string;
  name: string;
  position: number;
  permissions: string | number;
  color?: number;
  colors?: { primary_color: number; secondary_color: number | null; tertiary_color: number | null };
  hoist?: boolean;
  hoist_position?: number | null;
  mentionable?: boolean;
  managed?: boolean;
  icon?: string | null;
  unicode_emoji?: string | null;
  icon_emoji_id?: string | null;
}

export interface ForumTagRecord {
  id: string;
  name: string;
  moderated?: boolean;
  emoji_id?: string | null;
  emoji_name?: string | null;
}

export interface ThreadMetadata {
  archived: boolean;
  auto_archive_duration: number;
  archive_timestamp?: string;
  locked?: boolean;
  invitable?: boolean;
  create_timestamp?: string;
}

export interface MicupChannel {
  id: string;
  guild_id?: string;
  type?: number;
  parent_id?: string | null;
  name?: string;
  topic?: string | null;
  url?: string | null;
  icon?: string | null;
  owner_id?: string;
  position?: number;
  bitrate?: number;
  user_limit?: number;
  voice_connection_limit?: number;
  rtc_region?: string | null;
  rtc_p2p?: boolean;
  nsfw?: boolean;
  nsfw_override?: boolean | null;
  content_warning_level?: number;
  content_warning_text?: string | null;
  rate_limit_per_user?: number;
  last_message_id?: string | null;
  last_pin_timestamp?: string | null;
  permission_overwrites?: readonly PermissionOverwrite[];
  permissions?: string | number;
  recipients?: readonly MicupUser[];
  nicks?: Readonly<Record<string, string>>;
  flags?: number;
  thread_metadata?: ThreadMetadata;
  message_count?: number;
  total_message_sent?: number;
  member_count?: number;
  applied_tags?: readonly string[];
  member_ids_preview?: readonly string[];
  member?: ThreadMember;
  default_auto_archive_duration?: number;
  default_thread_rate_limit_per_user?: number;
  available_tags?: readonly ForumTagRecord[];
  default_reaction_emoji?: { emoji_id?: string | null; emoji_name?: string | null } | null;
  default_sort_order?: number | null;
  default_forum_layout?: number;
  default_tag_setting?: string;
}

export interface MicupMember {
  user?: MicupUser;
  roles: readonly string[];
  nick?: string | null;
  avatar?: string | null;
  banner?: string | null;
  accent_color?: number | null;
  joined_at?: string;
  mute?: boolean;
  deaf?: boolean;
  flags?: number;
  profile_flags?: number;
  mention_flags?: number;
  communication_disabled_until?: string | null;
  permissions?: string | number;
}

export interface MicupVoiceState {
  guild_id?: string;
  user_id: string;
  channel_id: string | null;
  connection_id?: string;
  member?: MicupMember;
  self_mute?: boolean;
  self_deaf?: boolean;
}

export interface MicupGuild {
  id: string;
  name?: string;
  owner_id?: string;
  unavailable?: boolean;
  features?: string[];
  icon?: string | null;
  banner?: string | null;
  splash?: string | null;
  afk_channel_id?: string | null;
  afk_timeout?: number;
  system_channel_id?: string | null;
  system_channel_flags?: number;
  rules_channel_id?: string | null;
  vanity_url_code?: string | null;
  verification_level?: number;
  mfa_level?: number;
  nsfw?: boolean;
  nsfw_level?: number;
  explicit_content_filter?: number;
  default_message_notifications?: number;
  premium_tier?: number;
  premium_subscription_count?: number;
  member_count?: number;
  online_count?: number;
  embed_splash?: string | null;
  splash_card_alignment?: number;
  badge_ids?: string[];
  content_warning_level?: number;
  content_warning_text?: string | null;
  disabled_operations?: number;
  message_history_cutoff?: string | null;
  permissions?: string | number;
  approximate_member_count?: number;
  approximate_presence_count?: number;
  guild_tag?: string | null;
  guild_tag_badge?: string | null;
  roles?: MicupRole[];
  emojis?: { id: string; name?: string; animated?: boolean }[];
  stickers?: { id: string; name?: string }[];
}

export interface MicupGuildCreate extends MicupGuild {
  properties?: Partial<MicupGuild>;
  channels?: MicupChannel[];
  threads?: MicupChannel[];
  voice_states?: MicupVoiceState[];
  members?: MicupMember[];
}

export interface MicupMembersChunk {
  guild_id: string;
  members: MicupMember[];
  chunk_index: number;
  chunk_count: number;
  not_found?: string[];
  nonce?: string;
}

export interface ThreadMember {
  id?: string;
  user_id?: string;
  join_timestamp?: string;
  flags?: number;
  member?: MicupMember;
}
