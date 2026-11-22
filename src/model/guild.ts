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
  managed?: boolean;
  icon?: string | null;
}

export interface MicupChannel {
  id: string;
  guild_id?: string;
  type?: number;
  parent_id?: string | null;
  name?: string;
  topic?: string | null;
  bitrate?: number;
  permission_overwrites?: readonly PermissionOverwrite[];
}

export interface MicupMember {
  user?: MicupUser;
  roles: readonly string[];
  nick?: string | null;
  avatar?: string | null;
  communication_disabled_until?: string | null;
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
  roles?: MicupRole[];
  emojis?: { id: string; name?: string }[];
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
