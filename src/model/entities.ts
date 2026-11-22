export interface MicupUser {
  id: string;
  username: string;
  bot?: boolean;
  global_name?: string | null;
  discriminator?: string;
  avatar?: string | null;
  banner?: string | null;
  tag_guild_id?: string | null;
}

export interface MessageAttachment {
  id: string;
  filename: string;
  url: string;
  proxy_url?: string;
  description?: string | null;
  size?: number;
  content_type?: string;
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
  guild_id?: string;
  flags?: number;
  timestamp?: string;
  edited_timestamp?: string | null;
  pinned?: boolean;
  webhook_id?: string;
  attachments?: readonly MessageAttachment[];
  message_reference?: MessageReference;
}
