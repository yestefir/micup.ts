# micup.ts

TypeScript client for the Micup bot API, based on [micup.go](https://github.com/yestefir/micup.go). The initial release covers endpoint discovery, bot identity and sending text messages or replies.

Requires Node.js 22 or later and a Micup bot token. The build produces JavaScript and TypeScript declarations. After the first npm release, install it with:

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

Run `npm ci` once, then `npm test` to verify the REST client locally.

MIT license. See [LICENSE](LICENSE).
