import type { MicupUser } from '../rest/client.js';

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
