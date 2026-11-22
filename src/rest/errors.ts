export interface MicupFieldError {
  path: string;
  code: string;
  message: string;
}

interface APIErrorBody {
  message?: unknown;
  code?: unknown;
  errors?: MicupFieldError[];
  retry_after?: unknown;
  global?: unknown;
}

export function retryDelay(value: unknown): number {
  if (typeof value !== 'number' && typeof value !== 'string') return 0;
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds > 0 ? Math.min(2_147_483_647, Math.ceil(seconds * 1000)) : 0;
}

export const MicupErrorCode = Object.freeze({
  InvalidFormBody: 'INVALID_FORM_BODY',
  RateLimited: 'RATE_LIMITED',
  NewDMRateLimited: 'NEW_DM_RATE_LIMITED',
  SlowmodeRateLimited: 'SLOWMODE_RATE_LIMITED',
  ResourceLocked: 'RESOURCE_LOCKED',
  Unauthorized: 'UNAUTHORIZED',
  MissingAccess: 'MISSING_ACCESS',
  MissingPermissions: 'MISSING_PERMISSIONS',
  TwoFactorRequired: 'TWO_FACTOR_REQUIRED',
  CommunicationDisabled: 'COMMUNICATION_DISABLED',
  ContentBlocked: 'CONTENT_BLOCKED',
  SpamBlocked: 'SPAM_BLOCKED',
  CannotSendEmptyMessage: 'CANNOT_SEND_EMPTY_MESSAGE',
  UnknownChannel: 'UNKNOWN_CHANNEL',
  UnknownGuild: 'UNKNOWN_GUILD',
  UnknownMember: 'UNKNOWN_MEMBER',
  UnknownMessage: 'UNKNOWN_MESSAGE',
  UnknownRole: 'UNKNOWN_ROLE',
  UnknownUser: 'UNKNOWN_USER',
  UnknownInvite: 'UNKNOWN_INVITE',
  UnknownEmoji: 'UNKNOWN_EMOJI',
  UnknownSticker: 'UNKNOWN_STICKER',
  UnknownWebhook: 'UNKNOWN_WEBHOOK',
  ThreadArchived: 'THREAD_ARCHIVED',
  ThreadLocked: 'THREAD_LOCKED',
  MaxActiveThreads: 'MAX_ACTIVE_THREADS',
  NsfwAgeRestricted: 'NSFW_CONTENT_AGE_RESTRICTED',
  FeatureTemporarilyDisabled: 'FEATURE_TEMPORARILY_DISABLED',
  VoiceRoomNotActive: 'VOICE_ROOM_NOT_ACTIVE',
  RoomTournamentConflict: 'ROOM_TOURNAMENT_CONFLICT',
  UnknownRoomTournament: 'UNKNOWN_ROOM_TOURNAMENT',
  SudoModeRequired: 'SUDO_MODE_REQUIRED',
} as const);

export class MicupAPIError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly retryAfter: string | null;
  readonly retryAfterMs: number;
  readonly requestId: string | null;
  readonly global: boolean;
  readonly errors: readonly MicupFieldError[];

  constructor(response: Response, body?: APIErrorBody) {
    super(typeof body?.message === 'string' ? body.message : 'Micup API returned HTTP ' + response.status);
    this.name = 'MicupAPIError';
    this.status = response.status;
    this.code = typeof body?.code === 'string' ? body.code : undefined;
    this.retryAfter = response.headers.get('retry-after');
    this.retryAfterMs = retryDelay(body?.retry_after) || retryDelay(this.retryAfter);
    this.requestId = response.headers.get('x-request-id');
    this.global = body?.global === true || response.headers.get('x-ratelimit-global') === 'true';
    this.errors = Array.isArray(body?.errors) ? body.errors : [];
  }

  get notFound(): boolean {
    return this.status === 404;
  }

  get forbidden(): boolean {
    return this.status === 403;
  }

  get rateLimited(): boolean {
    return this.status === 429;
  }

  hasFieldCode(code: string): boolean {
    return this.errors.some((error) => error.code === code);
  }
}
