# Gateway and sharding

## Sessions

`client.newSession(options)` returns a `GatewaySession`. `session.run({ signal })` keeps it connected until the signal aborts: it reconnects with backoff, resumes from the last processed sequence and starts a new session when the old one is invalid. `session.runOnce({ signal })` connects once and returns when the connection ends, for applications that manage reconnects.

```js
const session = client.newSession({
  handler: events.handle,
  compress: true,
  trackMembers: true,
  presence: { status: 'online', custom_status: { text: 'Merhaba' } },
  onReady: (resumed) => console.log(resumed ? 'resumed' : 'ready'),
  onDisconnect: (error) => console.warn('disconnected', error),
});
await session.run({ signal: stop.signal });
```

| Option | Meaning |
| --- | --- |
| `handler` | required; called with every dispatch and an `AbortSignal` that aborts when the connection or session is replaced |
| `ignoredEvents` | event names the session does not need |
| `compress` | continuous Zstandard stream; needs Node.js 22.15 or later |
| `trackMembers` | maintain paginated member inventories, read through `session.memberInventories()` |
| `presence` | initial presence |
| `minBackoffMs`, `maxBackoffMs` | reconnect delay bounds (1 s and 15 s by default) |
| `flags` | Gateway feature flags (`GatewayFlag`) |
| `onReady`, `onDisconnect`, `onGatewayError`, `beforeIdentify` | lifecycle hooks |
| `logger` | `{ info?, warn }`; receives gateway lifecycle events and member inventory sync failures (with the guild ID and error) and the shard number |
| `onVoiceLost`, `onVoiceEmpty`, `onVoiceGrant` | voice hooks, see [Voice](voice.md) |

Lifecycle and voice hooks may return promises. Their thrown errors and rejected promises are reported through the configured logger, or `console.error` when no logger is configured; they do not stop the Gateway session.

A handler that throws is retried with the same event, so keep side effects safe to repeat. Wrap handlers with `safeHandler()` to log failures, time out slow work or replay only selected errors.

## Events

`EventMux` routes dispatches by name with typed payloads.

```js
import { EventMux, safeHandler } from 'micup.ts';

const events = new EventMux();
const off = events.on('MESSAGE_CREATE', (message, event, signal) => { /* ... */ });
events.on('GUILD_MEMBER_ADD', safeHandler((event, signal) => { /* ... */ }, { timeoutMs: 5_000, onError: console.error }));
```

`knownGatewayEvents` lists every typed event: messages, reactions, guilds, members, roles, channels, threads, invites, webhooks, bans, audit log entries, presence, typing, voice states, calls, soundboard changes and playback, and more. Unknown names can be registered and carry an `unknown` payload. Use `onGuildTagChange()` to follow guild tag changes.
`GUILD_UPDATE` carries both `id` and `guild_id`; the easy client wraps it as a `Guild`.

Do slow work such as searches outside the handler so the next event is not delayed:

```js
import { background } from 'micup.ts';
void background((signal) => search(signal), { timeoutMs: 30_000, name: 'search' });
```

## Presence

```js
await session.setStatus('idle');
await session.setCustomStatus({ text: 'Merhaba' });
await session.setCustomStatus(null);
```

Statuses are `online`, `idle`, `dnd` and `invisible`. Micup has no activities, only a custom status text.

## Requests over the Gateway

```js
const members = await session.requestGuildMembers(guildId, { query: 'ad', limit: 10 });
const counts = await session.requestGuildCounts([guildId]);
const online = await session.requestChannelMemberCounts(guildId, [channelId]);
await session.subscribe({ [guildId]: { active: true, typing: true, threads: true } });
```

`subscribe()` takes subscriptions keyed by server ID (`active`, `sync`, `typing`, `members`, `threads`, `member_list_channels`, `thread_member_lists`). Member and count requests carry a nonce and reject with `GatewayRequestError` on rate limits or timeouts.

## State cache

Each session keeps `session.state` (a `GatewayState`) up to date from the stream.

```js
const guild = session.state.guild(guildId);
const channel = session.state.channel(channelId);
const permissions = session.state.permissions(guildId, userId, channelId);
const canManage = session.state.canManage(guildId, actorId, targetId);
const inVoice = session.state.voiceMembers(guildId, channelId);
const botChannel = session.state.voiceChannel(guildId, client.self.id);
```

Also available: `member`, `channels`, `threads`, `highestRole` and `guildForChannel`. Permission helpers `computePermissions`, `hasPermissions`, `missingPermissions`, `permissionNames` and `parsePermission` work on plain `bigint` masks.

## Sharding

`await client.recommendedShards()` counts the bot's servers and uses the service's Gateway recommendation when available. If that endpoint is unavailable, the SDK targets one shard per 2,000 servers and always returns at least one.

```js
const manager = client.newShardManager({
  shardCount: await client.recommendedShards(),
  session: { handler: events.handle, compress: true },
});
await manager.run({ signal: stop.signal });
```

The manager spaces IDENTIFY commands (`identifyIntervalMs`), runs `shardIds` when you split shards across processes, and exposes `shard(id)`, `forGuild(guildId)`, `shards`, `guildCount`, `latency`, `ready`, presence setters and the voice and request helpers of a session. `shardForGuild(guildId, shardCount)` returns the shard that owns a server; a server's events arrive only on its own shard.
