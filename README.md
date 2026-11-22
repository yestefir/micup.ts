# micup.ts

The TypeScript SDK for [Micup](https://micup.gg) bots. It connects a bot to the Micup Gateway and REST API with reconnects, resume, sharding, rate-limit handling and full type declarations, and covers slash commands, buttons, select menus, modals, soundboard, voice rooms and voice playback.

[Türkçe README](README.tr.md) · [Docs](docs/README.md) · [Changelog](CHANGELOG.md)

```sh
npm install micup.ts
```

Requires Node.js 22 or later and a Micup bot token. Based on [micup.go](https://github.com/yestefir/micup.go), the Go library that runs production bots.

## Quick start

The easy client is the fastest way to a working bot. Set `MICUP_BOT_TOKEN` and run:

```js
import { Client, SlashCommand, actionRow, primaryButton } from 'micup.ts/easy';

const client = new Client();

client.on('messageCreate', async (message) => {
  if (message.author.bot || message.content !== '!ping') return;
  await message.reply('pong');
});

client.command(new SlashCommand('hello', 'Say hello').addString('name', 'Who to greet'), async (interaction) => {
  const name = interaction.options.getString('name') ?? interaction.user.displayName;
  await interaction.reply({ content: `Merhaba ${name}!`, components: [actionRow(primaryButton('again', 'Again'))] });
});

client.component('again', (interaction) => interaction.update({ content: 'Merhaba again!', components: [] }));

await client.login();
```

`login()` connects, waits for your servers, registers the `hello` command and starts routing. Errors in your handlers never crash the bot: they are emitted as `error`, and a command that fails before answering gets a private error reply. See [The easy client](docs/easy-client.md).

For full control over sessions, shards and handler retries, use the core API:

```js
import { EventMux, InteractionRouter, MicupClient, actionRow, primaryButton } from 'micup.ts';

const client = await MicupClient.connect({ token: process.env.MICUP_BOT_TOKEN });
await client.commands.create({ name: 'ping', description: 'Check the bot' }, { guildId: process.env.MICUP_GUILD_ID });

const router = new InteractionRouter()
  .command('ping', (interaction, signal) =>
    client.interactions.respond(interaction, {
      content: 'pong',
      components: [actionRow(primaryButton('again', 'Again'))],
    }, { signal }))
  .component('again', (interaction, signal) =>
    client.interactions.update(interaction, { content: 'pong again', components: [] }, { signal }));

const events = new EventMux();
events.on('INTERACTION_CREATE', (interaction, event, signal) => router.handle(interaction, signal));

const stop = new AbortController();
process.once('SIGINT', () => stop.abort());
await client.newSession({ handler: events.handle }).run({ signal: stop.signal });
```

`client.newSession().run()` reconnects with backoff and resumes from the last processed sequence. A failed handler can receive its event again, so keep externally visible effects safe to repeat.

## What is inside

| Area | What you get | Start here |
| --- | --- | --- |
| Easy client | `Client` with events, `message.reply()`, `interaction.reply()`, a slash command builder, automatic command registration and routing, buttons, menus, modals, autocomplete and safe error handling | `micup.ts/easy` |
| Client | Authenticated REST with rate-limit waits, retries, audit-log reasons, `AbortSignal` support, bot identity (`self`, `application()`, `tokenId`) | `MicupClient` |
| Gateway | Supervised sessions with resume, heartbeat checks, Zstandard compression, presence, lazy subscriptions, member inventories, guild and channel counts | `client.newSession()` |
| Sharding | Shard manager that spaces IDENTIFY, routes guilds to shards and recommends a shard count | `client.newShardManager()` |
| State | Cache of guilds, channels, threads, members, roles and voice states with permission and hierarchy checks | `session.state` |
| Commands and interactions | Slash and context menu commands, autocomplete, buttons, select menus, modals, deferred and private replies, follow-ups, routing by name | `client.commands`, `client.interactions`, `InteractionRouter` |
| Messages | Send, edit, reply, forward, crosspost, search, bulk delete, embeds, direct uploads, embed suppression, reactions, pins | `client.sendMessage()`, `client.channels`, `client.attachments` |
| Servers | Guild, member, role, ban, timeout, audit log, vanity URL, channel layout, invites, threads and forums, webhooks | `client.guilds`, `client.channels`, `client.webhooks` |
| Expressions | Emoji and sticker listing, creation, cloning, bulk creation | `client.expressions` |
| Sound | Soundboard sounds, playback in a voice channel, guild and channel notification sounds | `client.sounds` |
| Voice rooms | The 3D room stage (board or video on the room TV, host, effects) and room tournaments | `client.rooms` |
| Discovery | Read, apply for, edit and withdraw a server discovery listing | `client.discovery` |
| Events | A typed catalog of Gateway events, an event mux and handler wrappers | `EventMux`, `knownGatewayEvents`, `safeHandler()` |
| Helpers | Constant groups, button and select builders, command option readers, permission helpers, mentions, timestamps, snowflakes, localized message catalogs | `ChannelType`, `primaryButton()`, `optionString()`, `permissionNames()` |
| Voice playback | LiveKit audio with FFmpeg decoding, PCM player and a connection object with events | [`@micup.ts/voice`](packages/voice) |

Everything takes an optional `AbortSignal`. HTTP failures throw `MicupAPIError` with `status`, `code`, field errors, `retryAfter` and helpers such as `notFound`, `rateLimited` and `hasFieldCode()`. `MicupErrorCode` names the error codes.

## More examples

Read command options and open a modal:

```js
import { modalRows, optionString, shortInput } from 'micup.ts';

router.command('hello', async (interaction, signal) => {
  const name = optionString(interaction.data, 'name') ?? 'there';
  await client.interactions.respond(interaction, `Hello ${name}`, { ephemeral: true, signal });
});

router.command('feedback', (interaction, signal) =>
  client.interactions.modal(interaction, {
    title: 'Feedback',
    custom_id: 'feedback',
    components: modalRows(shortInput('subject', 'Subject')),
  }, { signal }));
```

Run several shards and move slow work off the Gateway handler:

```js
import { background } from 'micup.ts';

const manager = client.newShardManager({
  shardCount: await client.recommendedShards(),
  session: { handler: events.handle, compress: true, trackMembers: true },
});
void background(async (signal) => { await slowSearch(signal); }, { timeoutMs: 30_000, name: 'search' });
await manager.run({ signal: stop.signal });
```

Log requests that fail because the bot lacks a permission, at most once a minute per route (sessions take the same `logger` option for connects, resumes and disconnects):

```js
const client = await MicupClient.connect({
  token: process.env.MICUP_BOT_TOKEN,
  logger: { warn: (message, fields) => console.warn(message, fields) },
});
```

## Voice

[`@micup.ts/voice`](packages/voice) publishes audio to a voice channel through LiveKit. `VoiceConnection` joins the channel, plays files, URLs, streams or raw PCM, and emits `start`, `finish`, `status`, `memberJoin`, `memberLeave`, `disconnect` and `error`. Install it with `npm install @micup.ts/voice` and install FFmpeg to decode files and streams.

## Documentation

- [The easy client](docs/easy-client.md): `micup.ts/easy`, events, objects, commands, interactions and errors
- [Getting started](docs/getting-started.md): token, invite link, first bot, project layout
- [Commands and interactions](docs/commands-and-interactions.md): commands, options, buttons, selects, modals, autocomplete, private replies
- [Gateway and sharding](docs/gateway-and-sharding.md): sessions, resume, presence, shards, state cache, events
- [REST reference](docs/rest-reference.md): every resource and method
- [Voice](docs/voice.md): joining, playing, regranting, soundboard and voice rooms
- [Errors and limits](docs/errors-and-limits.md): error handling, rate limits, cancellation, logging
- [Migrating](docs/migrating.md): from micup.js, micup.gg.js or discord.js

## Reliability

The test suite runs the SDK against mocked servers and a local LiveKit room. Releases are also checked end to end against the Micup service with a live bot: commands, autocomplete, buttons, select menus, modals, deferred and private replies, REST resources and voice playback.

Run `npm ci` once, then `npm test` to verify both workspaces locally.

MIT license. See [LICENSE](LICENSE).
