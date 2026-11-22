# micup.ts

TypeScript SDK for Micup bots (Fluxer API), based on [micup.go](https://github.com/yestefir/micup.go). The SDK includes API discovery, REST requests and supervised Gateway sessions.

Requires Node.js 22 or later and a Micup bot token. The build produces JavaScript and TypeScript declarations. Install it with:

```sh
npm install micup.ts
```

```js
import { MicupClient } from 'micup.ts';

const client = await MicupClient.connect({ token: process.env.MICUP_BOT_TOKEN });
const user = await client.getCurrentUser();
console.log(user.username);

await client.sendMessage(process.env.MICUP_CHANNEL_ID, 'Merhaba!');
```

Supply a message ID as `{ replyTo: '123456789' }` in the third argument to send a reply. Supply an `AbortSignal` as `{ signal }` to cancel an operation. HTTP errors expose `status`, the Micup error `code` when present, and the raw `retryAfter` header when present.

## Gateway

Use a session to keep a bot connected and receive events.

```js
import { EventMux, MicupClient } from 'micup.ts';

const bot = await MicupClient.connect({ token: process.env.MICUP_BOT_TOKEN });
const events = new EventMux();
events.on('MESSAGE_CREATE', async (message, event, signal) => {
  if (message.author.bot || message.content !== '!ping') return;
  await bot.sendMessage(message.channel_id, 'pong', { replyTo: message.id, signal });
});
const stop = new AbortController();
process.once('SIGINT', () => stop.abort());
process.once('SIGTERM', () => stop.abort());
await bot.newSession({ handler: events.handle }).run({ signal: stop.signal });
```

The session reconnects with backoff and resumes from the last successfully processed sequence. A failed handler can receive the event again, so make externally visible effects safe to repeat. The handler's signal is aborted when the connection or session is replaced. Unknown event names can be registered with the mux and have an `unknown` payload until you provide a type.

With `bot.newShardManager({ shardCount, session: { handler: events.handle } })`, a single process can run multiple shards. The manager spaces IDENTIFY commands and `manager.forGuild(guildId)` returns the local session responsible for a guild.

## Commands and interactions

Register slash commands for a development guild using `client.commands.set`. Omit `guildId` to register globally.

```js
import { EventMux, InteractionRouter, MicupClient } from 'micup.ts';

const client = await MicupClient.connect({ token: process.env.MICUP_BOT_TOKEN });
await client.commands.set([{ name: 'ping', description: 'Check the bot' }], {
  guildId: process.env.MICUP_GUILD_ID,
});

const router = new InteractionRouter().command('ping', (interaction, signal) =>
  client.interactions.respond(interaction, 'pong', { signal }),
);
const events = new EventMux();
events.on('INTERACTION_CREATE', async (interaction, event, signal) => {
  await router.handle(interaction, signal);
});
await client.newSession({ handler: events.handle }).run();
```

The router also handles autocomplete, buttons, select menus and modal submissions. Use `client.interactions.defer` and `editResponse` when work needs more time.

## Server administration

Use the `client.guilds` and `client.channels` APIs for members, roles, channel permissions, threads, pins, reactions and invitations. Each Gateway session exposes `session.state` for cached guilds, channels, members, voice states and permission checks.

## Gateway and REST options

Pass `compress: true` to use Micup's continuous Zstandard Gateway stream. On Node.js 22 this requires 22.15 or later. Use `session.runOnce()` when your application manages reconnects. Set `trackMembers: true` to maintain paginated member inventories and read their availability and completeness through `session.memberInventories()`.

Use `session.subscribe()` or `manager.subscribe()` for Lazy Request subscriptions. The shard manager groups subscriptions and counts by their owning shard. The typed event catalog is available as `knownGatewayEvents`.

`client.users` handles DM channels and profiles. `client.webhooks` and `client.expressions` manage webhooks and guild emoji or stickers. Use `client.attachments.upload()` for direct uploads, then pass the result in the message's `uploads` field. Forum posts, archived threads and reaction users are available through `client.channels`.

The SDK exports message catalogs, mention and snowflake helpers, media URLs, and builders for embeds, buttons, selects and modals. Pass `client.media` an entity to build its discovered CDN URL.

## Voice

The optional [`@micupts/voice`](packages/voice) workspace publishes audio to LiveKit. Install it with `npm install @micupts/voice` when your bot needs audio playback.

Run `npm ci` once, then `npm test` to verify both workspaces locally.

MIT license. See [LICENSE](LICENSE).
