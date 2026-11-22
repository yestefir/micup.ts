import type { MicupChannel, MicupGuild, MicupMember, MicupRole } from '../model/guild.js';
import type { MicupUser } from '../model/entities.js';
import { compareSnowflakes } from '../model/format.js';
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

export interface ChannelPosition {
  id: string;
  position?: number;
  parent_id?: string | null;
  preceding_sibling_id?: string | null;
  lock_permissions?: boolean;
}

export interface SudoProof {
  password?: string;
  mfa_method?: 'totp' | 'webauthn' | 'email_code';
  mfa_code?: string;
  webauthn_response?: unknown;
  webauthn_challenge?: string;
  email_code_ticket?: string;
  email_code?: string;
}

export interface CurrentMemberEdit extends Omit<GuildMemberEdit, 'roles'> {
  avatar?: string | null;
  banner?: string | null;
  bio?: string | null;
  pronouns?: string | null;
  accent_color?: number | null;
  profile_flags?: number;
  mention_flags?: number;
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
    if (!search || typeof search !== 'object' || Array.isArray(search)) throw new TypeError('A member search object is required');
    const { query = '', limit = 100, offset = 0, role_ids, join_source_type, source_invite_code } = search;
    if (typeof query !== 'string') throw new TypeError('A member search query must be a string');
    if ([role_ids, join_source_type, source_invite_code].some((values) => values !== undefined && !Array.isArray(values))) {
      throw new TypeError('Member search filters must be arrays');
    }
    if ([...query].length > 100 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100 ||
        !Number.isSafeInteger(offset) || offset < 0 ||
        [role_ids, join_source_type, source_invite_code].some((values) => (values?.length ?? 0) > 10)) {
      throw new RangeError('Invalid member search limit, offset, query or filters');
    }
    for (const id of role_ids ?? []) snowflake(id, 'Role ID');
    for (const value of join_source_type ?? []) {
      if (!Number.isSafeInteger(value) || value < 0) throw new TypeError('Member join source types must be nonnegative integers');
    }
    for (const value of source_invite_code ?? []) {
      if (typeof value !== 'string' || !value) throw new TypeError('Member source invite codes must be nonempty strings');
    }
    if (search.is_bot !== undefined && typeof search.is_bot !== 'boolean') throw new TypeError('The member bot filter must be a boolean');
    for (const [name, value] of Object.entries({
      joined_at_gte: search.joined_at_gte,
      joined_at_lte: search.joined_at_lte,
      user_created_at_gte: search.user_created_at_gte,
      user_created_at_lte: search.user_created_at_lte,
    })) {
      if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) throw new RangeError(name + ' must be a nonnegative integer timestamp');
    }
    if (search.sort_by !== undefined && (typeof search.sort_by !== 'string' || !search.sort_by)) throw new TypeError('Member search sort_by must be a nonempty string');
    if (search.sort_order !== undefined && search.sort_order !== 'asc' && search.sort_order !== 'desc') {
      throw new TypeError('Member search sort_order must be asc or desc');
    }
    return this.rest.request('POST', guildPath(guildId) + '/members-search', { ...options, body: search, idempotent: true });
  }

  moveChannels(guildId: string, positions: readonly ChannelPosition[], options?: MicupRequestOptions): Promise<void> {
    if (!Array.isArray(positions)) throw new TypeError('Channel positions must be an array');
    if (!positions.length) throw new RangeError('Moving channels needs at least one position');
    const body = Array.from(positions, (entry) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new TypeError('Channel positions must be objects');
      const { id, parent_id, preceding_sibling_id, ...position } = entry;
      return {
        ...position,
        id: snowflake(id, 'Channel ID'),
        ...(parent_id !== undefined && { parent_id: parent_id === null ? null : snowflake(parent_id, 'Parent ID') }),
        ...(preceding_sibling_id !== undefined && {
          preceding_sibling_id: preceding_sibling_id === null ? null : snowflake(preceding_sibling_id, 'Sibling ID'),
        }),
      };
    });
    return this.rest.request('PATCH', guildPath(guildId) + '/channels', { ...options, body });
  }

  getBan(guildId: string, userId: string, options?: MicupRequestOptions): Promise<GuildBan> {
    return this.rest.request('GET', guildPath(guildId) + '/bans/' + snowflake(userId, 'User ID'), options);
  }

  role(guildId: string, roleId: string, options?: MicupRequestOptions): Promise<MicupRole> {
    return this.rest.request('GET', guildPath(guildId) + '/roles/' + snowflake(roleId, 'Role ID'), options);
  }

  vanityUrl(guildId: string, options?: MicupRequestOptions): Promise<{ code: string | null; uses: number }> {
    return this.rest.request('GET', guildPath(guildId) + '/vanity-url', options);
  }

  editVanityUrl(guildId: string, code: string | null, options?: AuditOptions): Promise<{ code: string | null }> {
    if (code !== null && (code.length > 32 || !/^[A-Za-z0-9][A-Za-z0-9 -]*[A-Za-z0-9]$/.test(code))) {
      throw new TypeError('A custom invite code takes 2 to 32 letters, digits, spaces or inner hyphens');
    }
    return this.rest.request('PATCH', guildPath(guildId) + '/vanity-url', { ...options, body: { code } });
  }

  editCurrentMember(guildId: string, edit: CurrentMemberEdit, options?: AuditOptions): Promise<MicupMember> {
    return this.rest.request('PATCH', guildPath(guildId) + '/members/@me', { ...options, body: edit });
  }

  setNickname(guildId: string, nick: string | null, options?: AuditOptions): Promise<MicupMember> {
    if (nick !== null && ([...nick].length < 1 || [...nick].length > 32)) throw new RangeError('A nickname takes 1 to 32 characters');
    return this.editCurrentMember(guildId, { nick }, options);
  }

  findMembers(guildId: string, query: string, { limit = 1, signal }: MicupRequestOptions & { limit?: number } = {}): Promise<MicupMember[]> {
    if (typeof query !== 'string' || [...query].length > 100 || !Number.isSafeInteger(limit) || limit < 1 || limit > 1000) {
      throw new RangeError('A name search takes a query of up to 100 characters and a limit of 1 to 1000');
    }
    return this.rest.request('GET', guildPath(guildId) + '/members/search', {
      query: new URLSearchParams({ query, limit: String(limit) }), signal,
    });
  }

  transferOwnership(guildId: string, newOwnerId: string, { signal, reason, ...proof }: AuditOptions & SudoProof = {}): Promise<MicupGuild> {
    return this.rest.request('POST', guildPath(guildId) + '/transfer-ownership', {
      signal, reason, body: { new_owner_id: snowflake(newOwnerId, 'New owner ID'), ...proof },
    });
  }

  deleteOwnMessages(guildId: string, { signal, ...proof }: MicupRequestOptions & SudoProof = {}): Promise<void> {
    return this.rest.request('POST', '/users/@me' + guildPath(guildId) + '/messages/bulk-delete-mine', { signal, body: proof });
  }

  async *iterateMembers(guildId: string, { signal }: MicupRequestOptions = {}): AsyncGenerator<MicupMember> {
    let after: string | undefined;
    while (true) {
      const page: MicupMember[] = await this.members(guildId, { limit: 1000, after, signal });
      let next = after;
      for (const member of page) {
        yield member;
        next = member.user?.id ?? next;
      }
      if (page.length < 1000 || !next || after !== undefined && compareSnowflakes(next, after) <= 0) return;
      after = next;
    }
  }

  async *iterateAuditLog(
    guildId: string, { userId, actionType, signal }: MicupRequestOptions & { userId?: string; actionType?: number } = {},
  ): AsyncGenerator<GuildAuditLog['audit_log_entries'][number]> {
    let before: string | undefined;
    while (true) {
      const query = new URLSearchParams({ limit: '100' });
      if (before !== undefined) query.set('before', before);
      if (userId !== undefined) query.set('user_id', snowflake(userId, 'User ID'));
      if (actionType !== undefined) query.set('action_type', String(actionType));
      const page = await this.auditLog(guildId, query, { signal });
      for (const entry of page.audit_log_entries) yield entry;
      const last = page.audit_log_entries.at(-1)?.id;
      if (page.audit_log_entries.length < 100 || !last || before !== undefined && compareSnowflakes(last, before) >= 0) return;
      before = last;
    }
  }

  auditLog(guildId: string, query?: URLSearchParams, options?: MicupRequestOptions): Promise<GuildAuditLog> {
    return this.rest.request('GET', guildPath(guildId) + '/audit-logs', { ...options, query });
  }
}
