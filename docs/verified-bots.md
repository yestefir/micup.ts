# Verified bots

A bot that applies for Micup's verified status has three mandatory requirements: it follows the **rate limits**, it follows the **DM spam rules**, and it follows the **command localization rules**. micup.ts takes care of all three. This page says what the SDK does for each one so you can check it. Micup decides about the verification itself; your own code still decides whom the bot messages and what it says, and the SDK never works around a limit.

| Requirement | What micup.ts does |
| --- | --- |
| Rate limits | paces and retries REST requests by the headers and bodies Micup sends, keeps every Gateway command inside its budget, and stops repeating requests Micup rejects |
| DM spam rules | never sends a DM on its own, waits out a DM quota only when it clears quickly, and never retries a spam block |
| Command localization | translates command names, descriptions, options and choices from one catalog, and answers each interaction in the language of the user |

## Rate limits

### REST

- **Route buckets.** When a response carries `X-RateLimit-Remaining: 0`, the next request to that route waits for `X-RateLimit-Reset-After`, so the bucket is not denied in the first place.
- **429.** The SDK waits for `retry_after` from the body, falling back to the `Retry-After` header in delta-seconds or HTTP-date form, and sends the request again, up to `maxRestAttempts` (default 5). A wait of more than 30 seconds is not slept: the `MicupAPIError` is thrown at once with `retryAfterMs` so your code decides.
- **Global 429.** When `global` is true, every request of the token pauses, not only the route.
- **Global bucket.** Micup allows 50 requests per second for each caller. The SDK keeps a margin and sends at most 45 per second, so a burst of 500 calls is spread out instead of being denied. Webhook token requests and interaction callbacks do not count against the bucket on the server and are not slowed either.
- **Server errors.** `5xx` and network errors are retried with exponential backoff only for requests that are safe to repeat; `4xx` errors other than 429 are never retried.
- **Rejected requests.** Micup can block an address that keeps sending rejected requests, for example to a deleted webhook or with a revoked token. After 5 rejections (`401`, `403` or `404`) of the same method and path within a minute, the SDK stops sending that request for a minute and throws the last error from memory. After 3 rejections of the token itself (`401`) within a minute and no success in between, it stops all authenticated requests for a minute. A success clears the count. Pass `rejectedRequestLimit` to `MicupClient.connect()` or the easy client (`0` turns the guard off) to change the limit.

### Gateway

| Limit of Micup | What the SDK does |
| --- | --- |
| 600 payloads per 60 seconds | sends at most 540 and waits when the budget is used |
| Presence Update: 5 per 20 seconds | waits for room before it sends |
| at most 4 sized commands at once (member, count and lazy requests) | keeps at most 3 member and count requests in flight (1 member request and 2 count requests) |
| Request Guild Members: 12 per account and 40 per guild per 10 seconds | sends at most 10 per account and 35 per guild per 10 seconds |
| a full member list once per 30 seconds per guild | refuses a second full-list request in that time with a `GatewayRequestError` that carries `retryAfter`, without sending it |
| IDENTIFY spacing | the shard manager spaces IDENTIFY commands |
| heartbeat and reconnects | answers the heartbeat, resumes the session, and reconnects with backoff from 1 to 15 seconds; a fatal close code stops the session instead of retrying |
| `RATE_LIMITED` event | rejects the matching request with `GatewayRequestError` and `retryAfter` |

### What you should still do

- Answer interactions within three seconds, or defer first.
- Do your own bulk work with the `iterate*` helpers and `Promise.all` in small groups; the SDK paces the requests but cannot make a slow loop faster.
- Handle `MicupAPIError` with `rateLimited` and `retryAfterMs` for long waits.

## DM spam rules

- **No DMs on their own.** micup.ts sends a direct message only when you call `client.sendDM()`, `user.send()` or `client.users.createDM()`.
- **Quota.** Micup limits how many new one-to-one conversations a bot starts (the default is 60 per hour and 500 per 24 hours; the server controls the values). When the quota is spent, Micup answers `429` with `NEW_DM_RATE_LIMITED` and `retry_after`. The SDK waits and retries when the wait is 30 seconds or less, and throws at once otherwise. `MicupAPIError#retryAfterMs` tells you when to try again.
- **Spam block.** Micup rejects repeated content sent to different people who have not replied (by default the 21st recipient within 24 hours). The answer is `400` with `SPAM_BLOCKED`. The SDK never retries it.
- **No message after a failed DM.** `sendDM()` stops when the conversation cannot be opened, and nothing is sent.
- **Codes.** `MicupErrorCode.NewDMRateLimited` and `MicupErrorCode.SpamBlocked` name both codes.

```js
import { MicupAPIError, MicupErrorCode } from 'micup.ts';

try {
  await client.sendDM(userId, 'Your report is ready.');
} catch (error) {
  if (error instanceof MicupAPIError && error.code === MicupErrorCode.NewDMRateLimited) schedule(userId, error.retryAfterMs);
  else if (error instanceof MicupAPIError && error.code === MicupErrorCode.SpamBlocked) stopMessaging(userId);
  else throw error;
}
```

Good practice: message only people who asked for it (a command, a subscription), send different text to different people, and do not retry a spam block with changed wording.

## Command localization rules

- **Translations of commands.** Names, descriptions, options and choices carry translations that Micup shows to each user in their language. `localizeCommand()` fills them from one message catalog, and the easy client does it for every command at login (`new Client({ catalog })`).
- **Replies in the user's language.** Every interaction carries the `locale` of the user. `interaction.t(key)` answers from the catalog in that language, with a fallback text for missing translations, and the catalog message `error.generic` is the private error reply.
- **Checked before sending.** Each translation is validated with the limits of the original (name characters and length, description length, language tags), the error names the exact command, option or choice, and a command set with names that collide once translated is refused.
- **Kept current.** The easy client compares translations and edits a command when the catalog changes.

See [Localization](localization.md) for keys, examples and rules.

## How this is checked

The behaviors above have automated tests (`test/compliance.test.js`, `test/locale.test.js`, and the REST and Gateway suites), and the releases are run against the Micup service with a live bot. The rate limits and rules themselves belong to Micup and can change, so the SDK reads limits from responses wherever Micup sends them and keeps its own fixed budgets (45 and 540) below the documented ones.
