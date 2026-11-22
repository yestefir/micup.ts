export type PresenceStatus = 'online' | 'idle' | 'dnd' | 'invisible' | 'offline';

export interface CustomStatus {
  text?: string;
  expires_at?: string;
  emoji_id?: string;
  emoji_name?: string;
  emoji_animated?: boolean;
}

export interface Presence {
  status: PresenceStatus;
  afk?: boolean;
  mobile?: boolean;
  custom_status?: CustomStatus | null;
}

export function normalizePresence(presence: Presence): Presence {
  if (!['online', 'idle', 'dnd', 'invisible', 'offline'].includes(presence.status)) {
    throw new TypeError('Invalid Micup presence status');
  }
  const custom = presence.custom_status;
  if (custom) {
    if (!custom.text && !custom.emoji_id && !custom.emoji_name) throw new TypeError('Custom status needs text or an emoji');
    if ((custom.text?.length ?? 0) > 128 || (custom.emoji_name?.length ?? 0) > 32) throw new RangeError('Custom status text or emoji is too long');
    if (custom.emoji_id && !/^\d+$/.test(custom.emoji_id)) throw new TypeError('Invalid custom status emoji ID');
    if (custom.expires_at && (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/i.test(custom.expires_at) ||
        !Number.isFinite(Date.parse(custom.expires_at)) || Date.parse(custom.expires_at) <= Date.now())) {
      throw new RangeError('Custom status expiry must be a future RFC 3339 timestamp');
    }
  }
  return {
    status: presence.status === 'offline' ? 'invisible' : presence.status,
    afk: presence.afk ?? false,
    mobile: presence.mobile ?? false,
    custom_status: custom && { ...custom } || null,
  };
}

export function activePresence(presence: Presence): Presence {
  const custom = presence.custom_status;
  if (custom?.expires_at && Date.parse(custom.expires_at) <= Date.now()) return { ...presence, custom_status: null };
  return presence;
}
