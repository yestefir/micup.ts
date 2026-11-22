# The easy client

`micup.ts/easy` is the quickest way to write a Micup bot. It wraps the SDK in a `Client` with events, rich objects (`message.reply()`, `interaction.reply()`), automatic command registration and routing, and safe error handling. Everything in the core SDK is still there: `client.rest` is the full [`MicupClient`](rest-reference.md), and `micup.ts/easy` re-exports every export of `micup.ts`.

```js
import { Client } from 'micup.ts/easy';

const client = new Client();

client.on('messageCreate', async (message) => {
  if (message.author.bot || message.content !== '!ping') return;
  await message.reply('pong');
});

await client.login();
```

`new Client()` reads the token from `MICUP_BOT_TOKEN`. `login()` connects, waits for the Gateway and the initial server list, registers your commands and emits `ready`.

## Options

```js
const client = new Client({
  token: process.env.MICUP_BOT_TOKEN,
  shards: 'auto',
  trackMembers: true,
  presence: { status: 'online', custom_status: { text: 'Merhaba' } },
  registerCommands: { guildId: process.env.MICUP_GUILD_ID },
  logger: { info: console.info, warn: console.warn },
});
```

| Option | Meaning |
| --- | --- |
| `token` | bot token; falls back to `login(token)` and `MICUP_BOT_TOKEN` |
| `origin`, `maxRestAttempts` | passed to `MicupClient.connect()` |
| `rest` | an already connected `MicupClient` to reuse |
| `gateway` | `false` runs REST only: `login()` connects, registers commands and emits `ready` without a Gateway session |
| `shards` | a number or `'auto'` (one shard for each 1,000 servers); more than one shard uses the shard manager |
| `compress`, `trackMembers`, `presence`, `ignoredEvents`, `flags`, `minBackoffMs`, `maxBackoffMs` | Gateway session options, see [Gateway and sharding](gateway-and-sharding.md) |
| `logger` | `{ warn, info? }` for permission warnings and Gateway lifecycle |
| `registerCommands` | `false` turns automatic registration off; `{ guildId, prune }` scopes it (default: global commands, no pruning) |
| `errorReply` | the private message sent when a routed handler fails before answering: a string, a function `(error, interaction) => string`, or `false` for none |
| `sequential` | `true` waits for each listener before the next event (default: listeners run concurrently) |
| `readyTimeoutMs` | how long to wait for the initial servers before `ready` (default 15 s) |

`await client.destroy()` stops the Gateway and clears the session. `client.ready`, `client.user`, `client.readyAt`, `client.uptime`, `client.latency` and `client.guildCount` report state.

## Events

Subscribe with `on`, `once` and `off`. Listeners may be async. An error in a listener never reaches the Gateway: it is emitted as `error` (or printed when nobody listens), so a failing handler cannot crash the bot or replay the event.

| Event | Argument |
| --- | --- |
| `ready` | the client; servers are already loaded |
| `shardReady`, `shardResume` | the shard number |
| `shardDisconnect` | the reason |
| `error` | `(error, { event?, interaction? })` |
| `messageCreate` | `Message` |
| `messageUpdate` | `MessageUpdate` (partial: `id`, `channelId`, `content?`, `message` when complete, `fetch()`) |
| `messageDelete` | `{ id, channelId, guildId?, content?, authorId? }` |
| `interactionCreate` | `Interaction` (the specific subclass) |
| `guildCreate`, `guildUpdate` | `Guild` |
| `guildDelete` | `{ id, unavailable }` |
| `guildMemberAdd`, `guildMemberUpdate` | `Member` |
| `guildMemberRemove`, `guildBanAdd`, `guildBanRemove` | `{ guildId, user }` |
| `channelCreate`, `channelUpdate`, `channelDelete` | `Channel` |
| `messageReactionAdd`, `messageReactionRemove` | `ReactionEvent` |
| `voiceStateUpdate` | the voice state |
| `raw` | every Gateway dispatch |

Any Gateway event name works as well, with its typed payload: `client.on('INVITE_CREATE', (invite, event) => { ... })`. See `knownGatewayEvents`.

## Objects

Objects wrap the API data (`.raw`) and carry the client, so you can act on them directly.

| Object | Useful members |
| --- | --- |
| `User` | `id`, `username`, `displayName`, `tag`, `bot`, `mention`, `avatarURL()`, `send()`, `createDM()`, `fetch()` |
| `Member` | `user`, `nick`, `roles`, `displayName`, `joinedAt`, `isTimedOut()`, `hasRole()`, `permissions()`, `hasPermission()`, `kick()`, `ban()`, `timeout()`, `clearTimeout()`, `addRole()`, `removeRole()`, `setNickname()`, `send()` |
| `Message` | `id`, `content`, `author`, `member`, `channel`, `guild`, `createdAt`, `editedAt`, `attachments`, `embeds`, `mentions`, `fromSelf`, `isReply`, `reply()`, `edit()`, `delete()`, `react()`, `unreact()`, `pin()`, `unpin()`, `crosspost()`, `suppressEmbeds()`, `fetch()` |
| `Channel` | `id`, `name`, `topic`, `type`, `guild`, `isText()`, `isVoice()`, `isDM()`, `isThread()`, `send()`, `sendTyping()`, `fetchMessage()`, `fetchMessages()`, `messages()`, `bulkDelete()`, `createInvite()`, `edit()`, `setTopic()`, `delete()` |
| `Guild` | `id`, `name`, `ownerId`, `memberCount`, `features`, `iconURL()`, `fetchMember()`, `members()`, `findMembers()`, `fetchChannels()`, `fetchRoles()`, `kick()`, `ban()`, `unban()`, `leave()` |

`client.users.fetch(id)`, `client.guilds.get(id)` (from the Gateway cache), `client.guilds.fetch(id)`, `client.guilds.list()`, `client.channels.get(id)` and `client.channels.fetch(id)` look objects up. `message.react()` accepts a Unicode emoji or `<:name:id>`. `Message#channel` always works, even when the channel is not cached.

`message.reply(content)` takes a string or the usual message options (`embeds`, `components`, `files`, `allowed_mentions`). Entities are not cached beyond servers, channels, members and voice states: fetch what you need.

## Commands

Build a command with `SlashCommand` and register a handler in one call:

```js
import { Client, SlashCommand } from 'micup.ts/easy';

client.command(
  new SlashCommand('tool', 'Small tools')
    .addSubcommand('echo', 'Repeat text', (sub) => sub
      .addString('text', 'What to repeat', { required: true })
      .addInteger('count', 'How many times', { minValue: 1, maxValue: 5 }))
    .addSubcommand('pick', 'Pick a fruit', (sub) => sub.addString('fruit', 'Fruit', { required: true, autocomplete: true })),
);

client.command('tool echo', (interaction) =>
  interaction.reply(interaction.options.getString('text', true).repeat(interaction.options.getInteger('count') ?? 1)));
client.autocomplete('tool pick', (interaction) =>
  interaction.respond(['apple', 'apricot', 'banana'].filter((name) => name.startsWith(String(interaction.focused?.value)))));
```

- `client.command(definition, handler?)` records the definition and routes the name. `client.command('tool echo', handler)` only routes. A route that matches the full path wins; otherwise the handler of the parent path runs (`tool echo` → `tool`).
- The builder has `addString`, `addInteger`, `addNumber`, `addBoolean`, `addUser`, `addRole`, `addMentionable`, `addAttachment`, `addChannel`, `addSubcommand`, `addSubcommandGroup`, `setDefaultMemberPermissions()`, `setDMPermission()` and localization setters. Required options are moved to the front. A definition can also be a plain object, and `userCommand(name)` and `messageCommand(name)` build context menu commands.
- At login the client registers the commands you defined: it creates missing ones, edits changed ones and leaves identical ones alone. It never deletes commands unless you pass `registerCommands: { prune: true }`. Call `await client.registerCommands({ guildId, prune })` yourself for more control; it returns `{ created, updated, unchanged, deleted }`. Development tip: pass a `guildId` so new commands show up at once.
- Routes also exist for components and modals: `client.component('confirm', fn)`, `client.component('vote:*', fn)` (prefix) or `client.component(/^menu-\d+$/, fn)`, `client.modal('feedback', fn)`.

## Interactions

Handlers receive a subclass of `Interaction`: `CommandInteraction`, `AutocompleteInteraction`, `ComponentInteraction` or `ModalSubmitInteraction`. Check the kind with `isCommand()`, `isAutocomplete()`, `isComponent()`, `isButton()`, `isSelectMenu()` and `isModalSubmit()`.

Common to all: `user`, `member`, `guild`, `channel`, `guildId`, `channelId`, `locale`, `appPermissions`, `replied`, `deferred`, and the replies:

| Method | Use |
| --- | --- |
| `reply(content)` | answer once; `{ content, ephemeral: true }` makes it private |
| `deferReply({ ephemeral })` | answer later within 15 minutes |
| `editReply(content)`, `fetchReply()`, `deleteReply()` | work on the first answer |
| `followUp(content)` | send more messages, also with files |
| `text(catalog, key, ...values)` | translate with a `MessageCatalog` in the user's locale |

A second `reply()` throws `InteractionRepliedError` with a hint, and `editReply()` or `followUp()` before an answer does too. Answer within three seconds or defer.

`CommandInteraction` adds `commandName`, `subcommand`, `subcommandGroup`, `path`, `targetUser`, `targetMessage` (context menus), `showModal(modal)` and `options`: `getString`, `getInteger`, `getNumber`, `getBoolean`, `getUser`, `getMember`, `getRole`, `getChannel`, `getAttachment`, `has`, `focused`. Pass `true` as the second argument to throw when a value is missing:

```js
const text = interaction.options.getString('text', true);      // string
const count = interaction.options.getInteger('count');         // number | null
```

`ComponentInteraction` adds `customId`, `values`, `message`, `users`, `members`, `roles`, `channels`, `update(content)`, `deferUpdate()` and `showModal()`. `ModalSubmitInteraction` adds `customId` and `fields.getTextInputValue(id, required?)`. `AutocompleteInteraction` adds `focused` and `respond(choices)` (strings, numbers or `{ name, value }`, up to 25).

Build a modal with the `modal(customId, title, ...inputs)` helper and the `shortInput` and `paragraphInput` builders. Build buttons and menus with `actionRow`, `primaryButton`, `stringSelect` and the other [builders](commands-and-interactions.md#components).

### Waiting for an answer

```js
client.command('delete-all', async (interaction) => {
  await interaction.reply({ content: 'Sure?', components: [actionRow(dangerButton('confirm', 'Delete'))] });
  const click = await client.awaitInteraction({ filter: (i) => i.customId === 'confirm' && i.user.id === interaction.user.id, timeoutMs: 15_000 });
  await click.update({ content: 'Deleted.', components: [] });
});
```

`awaitInteraction()` rejects on timeout or when its `signal` aborts.

## Errors

When a routed handler throws, the client emits `error` with the interaction in the context and, if the interaction was not answered yet, replies privately with a short message so the user is not left with "interaction failed". Change the text with `errorReply`, or turn it off with `errorReply: false`.

```js
client.on('error', (error, { event, interaction }) => {
  console.error(event, interaction?.id, error);
});
```

After a reconnect the Gateway can replay an interaction; a second answer then fails with `INTERACTION_TOKEN_CONSUMED`, which the `error` event reports like any other failure.

## Presence and shards

```js
await client.setStatus('idle');
await client.setCustomStatus('Merhaba');
```

With `shards: 'auto'` or a number above one, presence calls reach every shard and `client.sessionFor(guildId)` returns the session that owns a server. `client.permissionsFor(guildId, userId, channelId?)` reads cached permissions.

## Going further

- `client.rest` is the full SDK client (`client.rest.guilds`, `client.rest.sounds`, ...). Voice playback uses `@micup.ts/voice` with `client.sessions[0]`.
- `client.handleDispatch(event)` feeds a Gateway dispatch by hand, which is handy in tests: `await client.handleDispatch({ name: 'MESSAGE_CREATE', data, sequence: 1, shardId: 0 })`.
- Prefer the [core API](getting-started.md) when you want full control over sessions, shards and handler retries; the easy client is built on it and the two can be mixed.
