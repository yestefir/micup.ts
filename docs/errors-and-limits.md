# Errors and limits

## API errors

Failed HTTP requests throw `MicupAPIError`.

```js
import { MicupAPIError, MicupErrorCode } from 'micup.ts';

try {
  await client.guilds.kick(guildId, userId, { reason: 'spam' });
} catch (error) {
  if (!(error instanceof MicupAPIError)) throw error;
  if (error.code === MicupErrorCode.MissingPermissions) return explainPermissions();
  if (error.notFound) return;
  if (error.rateLimited) console.warn('retry in', error.retryAfterMs, 'ms');
  if (error.hasFieldCode('USER_IS_NOT_BANNED')) return;
  throw error;
}
```

| Property | Meaning |
| --- | --- |
| `status` | HTTP status |
| `code` | Micup error code, for example `MISSING_PERMISSIONS` |
| `errors` | field errors: `{ path, code, message }` |
| `retryAfter`, `retryAfterMs` | raw `Retry-After` header and its delay in milliseconds; HTTP dates are converted to a relative delay |
| `global` | the rate limit is global |
| `requestId` | the `x-request-id` header, for support requests |
| `notFound`, `forbidden`, `rateLimited` | status checks |
| `hasFieldCode(code)` | a field error carries this code |

`MicupErrorCode` names the codes the SDK knows, including `NEW_DM_RATE_LIMITED` (the bot messaged too many new people) and `SPAM_BLOCKED`. A request can also fail with `FEATURE_TEMPORARILY_DISABLED` when the service has a feature switched off.

Other errors: `GatewayCloseError` (the Gateway closed; `fatal` says whether the SDK stops), `GatewayRequestError` (a member or count request failed), `VoiceRefusedError` (the channel is full or a voice option is unavailable), and REST, Gateway or attachment-upload connection `Error` objects with the original network error in `cause`. Invalid arguments raise `TypeError` or `RangeError`. The SDK checks arguments before it sends a request.

## Rate limits and retries

The SDK waits for rate-limit windows and retries on its own:

- `429` waits for `retry_after` in the response body, falling back to the `Retry-After` header (delta-seconds or HTTP date), and tries again; waits longer than 30 seconds fail instead.
- `423` retries after at least one second.
- `5xx` and network errors retry with exponential backoff for requests that are safe to repeat (`GET`, `PUT`, `DELETE`, and `POST` calls marked idempotent).
- `maxRestAttempts` (1 to 5, default 5) limits the tries.
- Requests are paced to at most 45 per second so the global bucket of Micup (50 per second) is not hit; webhook token requests and interaction callbacks are not counted.
- After 5 rejections (`401`, `403`, `404`) of the same method and path within a minute, the SDK stops sending that request for a minute and throws the last error; 3 rejections of the token (`401`) block all authenticated requests for a minute. `rejectedRequestLimit` changes the limit and `0` turns the guard off. See [Verified bots](verified-bots.md).

Repeated rejected requests can get an address blocked, so do not loop on a failing call: a deleted webhook, a revoked token or a missing permission.

## Cancellation

Pass `{ signal }` to any method. `AbortSignal.timeout(ms)` gives a deadline. Gateway handlers receive a signal that aborts when the connection or session is replaced; pass it on to your requests.

## Permission warnings

```js
const client = await MicupClient.connect({
  token: process.env.MICUP_BOT_TOKEN,
  logger: { warn: (message, fields) => console.warn(message, fields) },
});
```

The same `logger` option exists on `client.newSession()` and the shard manager's `session` options; there it reports Gateway connections, resumes, invalidated sessions and disconnects. The REST logger receives `bot lacks permission for this request` with the method, path, code and server ID, at most once a minute for each route. Webhook and interaction tokens are masked in logged paths. Logging is off unless you pass a logger.

## Handler safety

```js
import { safeHandler } from 'micup.ts';

events.on('MESSAGE_CREATE', safeHandler(handle, {
  timeoutMs: 10_000,
  onError: (error, event) => console.error(event.name, error),
  retry: (error) => error instanceof MicupAPIError && error.status >= 500,
}));
```

`safeHandler()` logs failures instead of crashing or forcing a reconnect, stops slow work after `timeoutMs` and rethrows only the errors `retry` selects, so the event is delivered again. Its `onError` callback can be synchronous or asynchronous; a callback failure is contained. `background(task, { timeoutMs, name, onError })` runs slow work outside the handler and never rejects, including when its error reporter fails.

## Limits

`Limits` holds the documented sizes, for example `Limits.EmbedTitle` (256), `Limits.EmbedFields` (25), `Limits.Embeds` (10), `Limits.BulkDelete` (100), `Limits.SelectOptions` (25) and `Limits.CommandChoices` (25). The SDK validates embeds, components, commands and attachments against them before sending.
