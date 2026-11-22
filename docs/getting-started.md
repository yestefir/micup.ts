# Getting started

## Requirements

- Node.js 22 or later. Zstandard Gateway compression (`compress: true`) needs 22.15 or later.
- A Micup bot token. Create an application in the Micup developer area, enable its bot and copy the token.
- An ES module project: set `"type": "module"` in `package.json` or use `.mjs` files. TypeScript projects use `"module": "NodeNext"`.

Keep the token in an environment variable such as `MICUP_BOT_TOKEN`. Never commit it, and regenerate it if it leaks.

```sh
npm install micup.ts
```

## Connect

`MicupClient.connect()` discovers the API, checks that the token belongs to a bot and loads the bot identity.

```js
import { MicupClient } from 'micup.ts';

const client = await MicupClient.connect({ token: process.env.MICUP_BOT_TOKEN });
console.log(client.self.id, client.self.username);
```

Options: `origin` (default `https://micup.gg`), `maxRestAttempts` (1 to 5, default 5) and `logger` (see [Errors and limits](errors-and-limits.md)).

`client.self` is the bot user. `await client.application()` reads the application once and caches it. `client.tokenId` reads the bot ID from the token without a request.

## Invite the bot

```js
import { Permission } from 'micup.ts';

const url = client.botInviteURL({
  permissions: Permission.ViewChannel | Permission.SendMessages | Permission.EmbedLinks,
});
console.log(url);
```

Pass `guildId` to preselect a server. Permissions are `bigint` values; `permissionNames(bits)` lists their names.

## A first bot with the easy client

```js
import { Client } from 'micup.ts/easy';

const client = new Client();

client.on('ready', (ready) => console.log('Logged in as', ready.user.username));
client.on('messageCreate', async (message) => {
  if (message.author.bot || message.content !== '!ping') return;
  await message.reply('pong');
});

await client.login();
```

`new Client()` reads `MICUP_BOT_TOKEN`. See [The easy client](easy-client.md) for commands, buttons, modals and error handling.

## A first bot with the core API

```js
import { EventMux, MicupClient } from 'micup.ts';

const client = await MicupClient.connect({ token: process.env.MICUP_BOT_TOKEN });
const events = new EventMux();

events.on('MESSAGE_CREATE', async (message, event, signal) => {
  if (message.author.bot || message.content !== '!ping') return;
  await client.sendMessage(message.channel_id, 'pong', { replyTo: message.id, signal });
});

const stop = new AbortController();
process.once('SIGINT', () => stop.abort());
process.once('SIGTERM', () => stop.abort());
await client.newSession({ handler: events.handle }).run({ signal: stop.signal });
```

Message events arrive for the servers the bot is in. Use [slash commands](commands-and-interactions.md) for anything users invoke on purpose.

## Suggested layout

```
src/
  index.js        connect, create the session, wire shutdown
  commands/       one file per command: a definition and a handler
  events/         event handlers registered on the EventMux
```

Register command definitions at startup with `client.commands.create()` or `client.commands.set()`, and route interactions with an `InteractionRouter`.

## Next steps

- [Commands and interactions](commands-and-interactions.md)
- [Gateway and sharding](gateway-and-sharding.md)
- [REST reference](rest-reference.md)
