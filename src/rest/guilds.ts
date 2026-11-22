import type { MicupChannel, MicupGuild, MicupMember, MicupRole } from '../model/guild.js';
import type { MicupUser } from '../model/entities.js';
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
  connection_id?: string;
  timeout_reason?: string;
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


export interface GuildMemberSearch {
  query?: string;
  limit?: number;
  offset?: number;
  role_ids?: readonly string[];
  join_source_type?: readonly number[];
  source_invite_code?: readonly string[];
  is_bot?: boolean;
  joined_at_gte?: number;
  joined_at_lte?: number;
  user_created_at_gte?: number;
  user_created_at_lte?: number;
  sort_by?: string;
  sort_order?: 'asc' | 'desc';
}

export interface GuildMemberSearchPage {
  guild_id: string;
  members: {
    id: string; guild_id: string; user_id: string; username: string; global_name?: string | null;
    nickname?: string | null; role_ids: string[]; joined_at: number; is_bot: boolean;
    supplemental?: { join_source_type?: number | null; source_invite_code?: string | null; inviter_id?: string | null };
  }[];
  page_result_count: number;
  total_result_count: number;
  indexing: boolean;
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

  moveRoles(guildId: string, positions: readonly { id: string; position: number }[], options?: AuditOptions): Promise<void> {
    this.#checkPositions(guildId, positions.map((entry) => ({ id: entry.id, position: entry.position })));
    return this.rest.request('PATCH', guildPath(guildId) + '/roles', { ...options, body: positions });
  }

  moveHoistedRoles(guildId: string, positions: readonly { id: string; hoist_position: number }[], options?: AuditOptions): Promise<void> {
    this.#checkPositions(guildId, positions.map((entry) => ({ id: entry.id, position: entry.hoist_position })));
    return this.rest.request('PATCH', guildPath(guildId) + '/roles/hoist-positions', { ...options, body: positions });
  }

  resetHoistedRoles(guildId: string, options?: AuditOptions): Promise<void> {
    return this.rest.request('DELETE', guildPath(guildId) + '/roles/hoist-positions', options);
  }

  #checkPositions(guildId: string, positions: readonly { id: string; position: number }[]): void {
    if (!positions.length || positions.some(({ id, position }) => id === guildId || !Number.isSafeInteger(position) || position < 0)) {
      throw new RangeError('Role positions require nonnegative positions and exclude the everyone role');
    }
    for (const { id } of positions) snowflake(id, 'Role ID');
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

  timeout(guildId: string, userId: string, durationMs: number, options: AuditOptions & { timeoutReason?: string } = {}): Promise<MicupMember> {
    const { timeoutReason, ...audit } = options;
    if (!Number.isSafeInteger(durationMs) || durationMs <= 0 || durationMs > 365 * 24 * 60 * 60 * 1000) {
      throw new RangeError('A Micup member timeout must be longer than zero and at most 365 days');
    }
    if (timeoutReason && [...timeoutReason].length > 512) throw new RangeError('A timeout reason must contain at most 512 characters');
    return this.editMember(guildId, userId, {
      communication_disabled_until: new Date(Date.now() + durationMs).toISOString(), timeout_reason: timeoutReason,
    }, audit);
  }

  clearTimeout(guildId: string, userId: string, options?: AuditOptions): Promise<MicupMember> {
    return this.editMember(guildId, userId, { communication_disabled_until: null }, options);
  }

  searchMembers(guildId: string, search: GuildMemberSearch, options?: MicupRequestOptions): Promise<GuildMemberSearchPage> {
    const { query = '', limit = 100, offset = 0, role_ids, join_source_type, source_invite_code } = search;
    if ([...query].length > 100 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100 ||
        !Number.isSafeInteger(offset) || offset < 0 ||
        [role_ids, join_source_type, source_invite_code].some((values) => (values?.length ?? 0) > 10)) {
      throw new RangeError('Invalid member search limit, offset, query or filters');
    }
    role_ids?.forEach((id) => snowflake(id, 'Role ID'));
    return this.rest.request('POST', guildPath(guildId) + '/members-search', { ...options, body: search, idempotent: true });
  }

  auditLog(guildId: string, query?: URLSearchParams, options?: MicupRequestOptions): Promise<GuildAuditLog> {
    return this.rest.request('GET', guildPath(guildId) + '/audit-logs', { ...options, query });
  }
}
