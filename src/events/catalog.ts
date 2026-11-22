import type { MicupUser } from '../model/entities.js';
import type { Emoji } from '../model/format.js';
import type { MicupMember, MicupVoiceState, ThreadMember } from '../model/guild.js';
import type { Presence } from '../model/presence.js';
import type { MicupInvite } from '../rest/channels.js';
import type { MicupSoundboardSound } from '../rest/sounds.js';
import type { ChannelMemberCount, GuildCount } from '../session/requests.js';

export interface PresenceUpdate extends Presence {
  user: MicupUser;
  guild_id?: string;
}

export interface MessageReaction {
  user_id: string;
  channel_id: string;
  message_id: string;
  guild_id?: string;
  emoji: Emoji;
  member?: MicupMember;
  burst?: boolean;
  type?: number;
  session_id?: string;
}

type ThreadMemberPresence = ThreadMember & { presence?: PresenceUpdate };
type MemberWithPresence = MicupMember & { presence?: PresenceUpdate };
type GuildBan = { guild_id: string; user: MicupUser };
type MemberListGroup = { id: string; count: number };
type MemberListItem = { group?: MemberListGroup; member?: MemberWithPresence };
type ReactionTarget = Pick<MessageReaction, 'channel_id' | 'message_id' | 'guild_id'>;
type Call = { channel_id: string; message_id?: string; region?: string | null; ringing?: string[]; voice_states?: MicupVoiceState[]; recipients?: string[]; created_at?: number };
type Relationship = { id: string; type: number; user?: MicupUser; since?: string; nickname?: string | null };
type Recipient = { channel_id: string; user: MicupUser };
type SessionStatus = { session_id: string; status: string; afk: boolean; mobile: boolean };

export interface AdditionalGatewayEvents {
  RATE_LIMITED: { opcode: number; retry_after: number; meta?: { guild_id?: string; nonce?: string } };
  SESSIONS_REPLACE: SessionStatus[];
  GATEWAY_ROLLOUT_UPDATE: { game_activity_enabled: boolean; game_activity_epoch: number; listening_activity: boolean };
  GUILD_AUDIT_LOG_ENTRY_CREATE: {
    id: string; guild_id: string; user_id?: string; target_id?: string; action_type: number; reason?: string;
    changes?: { key: string; old_value?: unknown; new_value?: unknown }[]; options?: Record<string, string | number | boolean>;
  };
  GUILD_BAN_ADD: GuildBan;
  GUILD_BAN_REMOVE: GuildBan;
  CHANNEL_PINS_UPDATE: { guild_id?: string; channel_id: string; last_pin_timestamp?: string | null };
  MESSAGE_DELETE_BULK: { ids: string[]; channel_id: string; guild_id?: string };
  MESSAGE_REACTION_ADD: MessageReaction;
  MESSAGE_REACTION_REMOVE: MessageReaction;
  MESSAGE_REACTION_REMOVE_ALL: ReactionTarget;
  MESSAGE_REACTION_REMOVE_EMOJI: ReactionTarget & { emoji: Emoji };
  MESSAGE_REACTION_ADD_MANY: ReactionTarget & { reactions: Pick<MessageReaction, 'user_id' | 'emoji' | 'member'>[] };
  PRESENCE_UPDATE: PresenceUpdate;
  TYPING_START: { channel_id: string; user_id: string; timestamp: number; guild_id?: string; member?: MicupMember };
  INVITE_CREATE: MicupInvite;
  INVITE_DELETE: { code: string; guild_id?: string; channel_id: string };
  WEBHOOKS_UPDATE: { guild_id: string; channel_id: string };
  APPLICATION_COMMANDS_UPDATE: { application_id: string; guild_id?: string; scope_id?: string; version: string };
  GUILD_EMOJIS_UPDATE: { guild_id: string; emojis: Emoji[] };
  GUILD_STICKERS_UPDATE: { guild_id: string; stickers: { id: string; name: string; description?: string; tags?: string; format_type?: number }[] };
  GUILD_SOUNDBOARD_SOUNDS_UPDATE: {
    guild_id: string; operation: 'create' | 'update' | 'delete'; sound_id: string; version: number; sound?: MicupSoundboardSound;
  };
  GUILD_SOUNDBOARD_SOUND_PLAY: {
    guild_id: string; channel_id: string; actor_id: string; session_id: string; sound_id: string; event_id: string;
    asset_version: string; volume: number; server_time: number; recipient_connection_id: string; recipient_soundboard_epoch?: number;
  };
  GUILD_MEMBER_LIST_UPDATE: {
    guild_id: string; id: string; channel_id?: string; member_count: number; online_count: number;
    groups?: MemberListGroup[]; ops?: { op: string; range?: number[]; items?: MemberListItem[] }[];
  };
  GUILD_COUNTS_UPDATE: { counts: GuildCount[]; nonce?: string };
  CHANNEL_RECIPIENT_ADD: Recipient;
  CHANNEL_RECIPIENT_REMOVE: Recipient;
  CHANNEL_MEMBER_COUNTS_UPDATE: { counts: ChannelMemberCount[]; nonce?: string };
  PRESENCE_UPDATE_BULK: { guild_id: string; presences: PresenceUpdate[] };
  PASSIVE_UPDATES: { guild_id: string; channels?: Record<string, string>; voice_states?: MicupVoiceState[] };
  THREAD_MEMBER_UPDATE: ThreadMember;
  THREAD_MEMBERS_UPDATE: {
    id: string; guild_id: string; member_count: number; added_members?: ThreadMemberPresence[]; removed_member_ids?: string[];
  };
  THREAD_MEMBER_LIST_UPDATE: { guild_id: string; thread_id: string; members: ThreadMemberPresence[] };
  CALL_CREATE: Call;
  CALL_UPDATE: Call;
  CALL_DELETE: { channel_id: string; unavailable?: boolean };
  ENTRANCE_SOUND_PLAY: {
    user_id: string; channel_id: string; guild_id?: string; sound_id: string; hash?: string; url: string; duration_ms?: number; content_type?: string;
  };
  RELATIONSHIP_ADD: Relationship;
  RELATIONSHIP_UPDATE: Relationship;
  RELATIONSHIP_REMOVE: { id: string };
}

export type { ThreadMember } from '../model/guild.js';
