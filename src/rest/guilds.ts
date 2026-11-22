import type { MicupChannel, MicupGuild, MicupMember, MicupRole } from '../model/guild.js';
import type { MicupUser } from './client.js';
import { snowflake } from './messages.js';
import type { MicupRequestOptions, RestTransport } from './transport.js';

export interface AuditOptions extends MicupRequestOptions {
  reason?: string;
}

export interface GuildMemberQuery extends MicupRequestOptions {
  limit?: number;
  after?: string;
}

export interface GuildMemberEdit {
  nick?: string | null;
  roles?: readonly string[];
  mute?: boolean;
  deaf?: boolean;
  communication_disabled_until?: string | null;
  channel_id?: string | null;
}

export interface GuildRoleEdit {
  name?: string;
  permissions?: bigint | string;
  color?: number;
  hoist?: boolean;
  mentionable?: boolean;
  icon?: string | null;
  unicode_emoji?: string | null;
}

export interface GuildBanInput {
  delete_message_seconds?: number;
  ban_duration_seconds?: number;
  reason?: string;
}

export interface GuildBan {
  user: MicupUser;
  reason: string | null;
  moderator_id?: string;
  banned_at?: string;
  expires_at?: string | null;
}

export interface GuildAuditLog {
  audit_log_entries: { id: string; action_type: number; target_id?: string | null; user_id?: string | null; reason?: string }[];
  users?: MicupUser[];
  webhooks?: { id: string; name?: string }[];
}

export function guildPath(id: string): string {
  return '/guilds/' + snowflake(id, 'Guild ID');
}

function memberPath(guildId: string, userId: string): string {
  return guildPath(guildId) + '/members/' + snowflake(userId, 'User ID');
}

function rolePayload({ permissions, ...body }: GuildRoleEdit): object {
  if (permissions === undefined) return body;
  const text = String(permissions);
  if (!/^\d{1,20}$/.test(text) || BigInt(text) > (1n << 64n) - 1n) throw new TypeError('Role permissions must be an unsigned 64-bit decimal value');
  return { ...body, permissions: text };
}

export class MicupGuilds {
  constructor(private readonly rest: RestTransport) {}

  get(guildId: string, options?: MicupRequestOptions): Promise<MicupGuild> {
    return this.rest.request('GET', guildPath(guildId), options);
  }

  edit(guildId: string, body: Omit<Partial<MicupGuild>, 'id' | 'roles'>, options?: AuditOptions): Promise<MicupGuild> {
    return this.rest.request('PATCH', guildPath(guildId), { ...options, body });
  }

  channels(guildId: string, options?: MicupRequestOptions): Promise<MicupChannel[]> {
    return this.rest.request('GET', guildPath(guildId) + '/channels', options);
  }

  roles(guildId: string, options?: MicupRequestOptions): Promise<MicupRole[]> {
    return this.rest.request('GET', guildPath(guildId) + '/roles', options);
  }

  createRole(guildId: string, role: GuildRoleEdit, options?: AuditOptions): Promise<MicupRole> {
    return this.rest.request('POST', guildPath(guildId) + '/roles', { ...options, body: rolePayload(role) });
  }

  editRole(guildId: string, roleId: string, role: GuildRoleEdit, options?: AuditOptions): Promise<MicupRole> {
    const path = guildPath(guildId) + '/roles/' + snowflake(roleId, 'Role ID');
    return this.rest.request('PATCH', path, { ...options, body: rolePayload(role) });
  }

  deleteRole(guildId: string, roleId: string, options?: AuditOptions): Promise<void> {
    return this.rest.request('DELETE', guildPath(guildId) + '/roles/' + snowflake(roleId, 'Role ID'), options);
  }

  member(guildId: string, userId: string, options?: MicupRequestOptions): Promise<MicupMember> {
    return this.rest.request('GET', memberPath(guildId, userId), options);
  }

  currentMember(guildId: string, options?: MicupRequestOptions): Promise<MicupMember> {
    return this.rest.request('GET', guildPath(guildId) + '/members/@me', options);
  }

  members(guildId: string, { limit, after, signal }: GuildMemberQuery = {}): Promise<MicupMember[]> {
    const query = new URLSearchParams();
    if (limit !== undefined) {
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw new RangeError('Member limit must be between 1 and 1000');
      query.set('limit', String(limit));
    }
    if (after !== undefined) query.set('after', snowflake(after, 'Member cursor'));
    return this.rest.request('GET', guildPath(guildId) + '/members', { query, signal });
  }

  editMember(guildId: string, userId: string, body: GuildMemberEdit, options?: AuditOptions): Promise<MicupMember> {
    return this.rest.request('PATCH', memberPath(guildId, userId), { ...options, body });
  }

  addMemberRole(guildId: string, userId: string, roleId: string, options?: AuditOptions): Promise<void> {
    return this.rest.request('PUT', memberPath(guildId, userId) + '/roles/' + snowflake(roleId, 'Role ID'), options);
  }

  removeMemberRole(guildId: string, userId: string, roleId: string, options?: AuditOptions): Promise<void> {
    return this.rest.request('DELETE', memberPath(guildId, userId) + '/roles/' + snowflake(roleId, 'Role ID'), options);
  }

  kick(guildId: string, userId: string, options?: AuditOptions): Promise<void> {
    return this.rest.request('DELETE', memberPath(guildId, userId), options);
  }

  bans(guildId: string, options?: MicupRequestOptions): Promise<GuildBan[]> {
    return this.rest.request('GET', guildPath(guildId) + '/bans', options);
  }

  ban(guildId: string, userId: string, body: GuildBanInput = {}, options?: AuditOptions): Promise<void> {
    const deletion = body.delete_message_seconds ?? 0;
    const duration = body.ban_duration_seconds ?? 0;
    if (!Number.isInteger(deletion) || deletion < 0 || deletion > 604800 ||
        !Number.isInteger(duration) || (duration !== 0 && (duration < 60 || duration > 63072000))) {
      throw new RangeError('Invalid Micup ban duration or message deletion window');
    }
    return this.rest.request('PUT', guildPath(guildId) + '/bans/' + snowflake(userId, 'User ID'), { ...options, body });
  }

  unban(guildId: string, userId: string, options?: AuditOptions): Promise<void> {
    return this.rest.request('DELETE', guildPath(guildId) + '/bans/' + snowflake(userId, 'User ID'), options);
  }

  auditLog(guildId: string, query?: URLSearchParams, options?: MicupRequestOptions): Promise<GuildAuditLog> {
    return this.rest.request('GET', guildPath(guildId) + '/audit-logs', { ...options, query });
  }
}
