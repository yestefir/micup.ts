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
}
