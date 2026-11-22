# Migrating

micup.ts is lower level than discord.js-style libraries: you create the client, then build a session, an event mux and a router. In return you get resume, sharding, typed events, real components and every bot route of the service.

## From micup.js or micup.gg.js

| Task | micup.js / micup.gg.js | micup.ts |
| --- | --- | --- |
| Log in | `new Client(); await client.login(token)` | `await MicupClient.connect({ token })` |
| Listen | `client.on('messageCreate', ...)` | `events.on('MESSAGE_CREATE', ...)` on an `EventMux`, then `client.newSession({ handler: events.handle }).run()` |
| Reply | `message.reply('text')` | `client.sendMessage(message.channel_id, 'text', { replyTo: message.id })` |
| Send | `client.send(channelId, 'text')` | `client.sendMessage(channelId, 'text')` |
| Raw call | `client.rest('GET', '/users/@me')` | `client.request('GET', '/users/@me')` |
| Buttons and menus | emulated with reactions (micup.js) | real components: `actionRow(primaryButton(...))`, `selectRow(stringSelect(...))` |
| Slash commands | not available (micup.js) or `client.rest.createGlobalApplicationCommand` | `client.commands.create/set` and an `InteractionRouter` |
| Voice | `connection.play(url)` | `VoiceConnection.connect(session, guildId, channelId)` then `connection.play(url)` from `@micup.ts/voice` |
| Presence | `client.setPresence(...)` | `session.setStatus()` and `session.setCustomStatus()` |
| Shards | not available | `client.newShardManager()` |

Differences to expect:

- Entities are plain JSON objects with the field names of the API (`channel_id`, `author`), not class instances with methods.
- Methods that change state live on resources: `client.guilds.kick()`, `client.channels.pin()`, `client.webhooks.execute()`.
- Every call takes an `AbortSignal`, and failures throw `MicupAPIError`.
- micup.ts sends no telemetry.
- Node.js 22 or later and ES modules.

## From discord.js

The concepts match; the names are closer to the wire format.

| discord.js | micup.ts |
| --- | --- |
| `new Client({ intents })`, `client.login()` | `MicupClient.connect()`; Micup has no intents |
| `client.on('interactionCreate')` | `events.on('INTERACTION_CREATE')` and `InteractionRouter` |
| `interaction.reply()`, `deferReply()`, `editReply()`, `followUp()` | `client.interactions.respond()`, `defer()`, `editResponse()`, `followUp()` |
| `interaction.options.getString('x')` | `optionString(interaction.data, 'x')` |
| `ActionRowBuilder`, `ButtonBuilder` | `actionRow(primaryButton(id, label))` |
| `EmbedBuilder` | `EmbedBuilder` with `.title()`, `.description()`, `.field()`, `.build()` |
| `PermissionsBitField` | `Permission` (bigint masks), `permissionNames()`, `hasPermissions()` |
| `ShardingManager` | `client.newShardManager()` |
| `@discordjs/voice` | `@micup.ts/voice` (LiveKit) |

Micup does not have polls, auto moderation rules, scheduled events, stage channels or bulk bans.
