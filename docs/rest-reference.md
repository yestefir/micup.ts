# REST reference

`MicupClient` exposes one object for each resource. Every method returns a promise, validates IDs before sending (`TypeError` for a bad ID) and takes an optional `{ signal }`. Methods that change server state also take `{ reason }`, which becomes the audit log reason.

## Client

| Method | Purpose |
| --- | --- |
| `sendMessage(channelId, content, { replyTo })` | send text or a message with embeds, components, files, uploads and stickers |
| `getMessage`, `listMessages`, `iterateMessages` | read one message, a page, or every message |
| `editMessage`, `deleteMessage`, `bulkDeleteMessages` | change or remove messages (1 to 100 IDs for bulk) |
| `suppressEmbeds(channelId, messageId, suppress)` | hide or show embeds and keep the other flags |
| `forwardMessage`, `crosspostMessage`, `deleteAttachment` | forward, publish, remove an attachment |
| `searchMessages(search)` | search a server or channel |
| `triggerTyping`, `sendDM` | typing indicator, direct message |
| `newSession()`, `newShardManager()`, `recommendedShards()` | Gateway entry points |
| `botInviteURL()`, `getCurrentUser()`, `application()`, `applicationId()`, `request()` | invite link, identity, raw request |

## User sessions

`MicupUserSession` is separate from `MicupClient` and accepts a user session token. It exposes the authenticated user as `self` and supports profile updates through `editCurrentUser`.

```js
import { MicupUserSession } from 'micup.ts';

const session = await MicupUserSession.connect({ token: process.env.MICUP_USER_TOKEN });
await session.editCurrentUser({ bio: 'Hello from Micup' });
```

Profile edits accept `username`, `global_name`, `avatar`, `banner`, `bio`, `pronouns`, `accent_color` and `mention_flags`. Fields outside this set are rejected before a request is sent.

## `client.guilds`

| Group | Methods |
| --- | --- |
| Server | `get`, `edit`, `channels`, `moveChannels`, `vanityUrl`, `editVanityUrl`, `transferOwnership`, `deleteOwnMessages`, `auditLog`, `iterateAuditLog` |
| Roles | `roles`, `role`, `createRole`, `editRole`, `deleteRole`, `moveRoles`, `moveHoistedRoles`, `resetHoistedRoles` |
| Members | `member`, `currentMember`, `members`, `iterateMembers`, `editMember`, `editCurrentMember`, `setNickname`, `addMemberRole`, `removeMemberRole`, `kick`, `timeout`, `clearTimeout`, `findMembers`, `searchMembers` |
| Bans | `bans`, `getBan`, `ban`, `unban` |

`guilds.createRole` requires a nonempty name. Role colors and permission masks are checked locally, and permission masks are sent as decimal strings.
Member updates validate role lists, nicknames, voice fields, timeout dates and profile values before sending requests.
Member searches accept the documented sort fields and join sources, enforce timestamp ranges, and reject unsupported body fields.
Guild updates accept only documented editable settings and validate field ranges, identifiers, feature lists and timestamps before sending requests.
Sticker updates require the current description and tags because the API clears either field when omitted.

## `client.channels`

| Group | Methods |
| --- | --- |
| Channels | `get`, `create`, `edit`, `delete`, `setPermission`, `deletePermission`, `addRecipient`, `removeRecipient`, `follow`, `followerStats`, `crosspostSource`, `deleteOwnMessages` |
| Pins and reactions | `pin`, `unpin`, `pins`, `iteratePins`, `addReaction`, `removeReaction`, `deleteReaction`, `reactionUsers`, `iterateReactionUsers` |
| Threads | `startThread`, `activeThreads`, `archivedThreads`, `searchThreads`, `joinThread`, `leaveThread`, `archiveThread`, `lockThread`, `addThreadMember`, `removeThreadMember`, `threadMember`, `threadMembers`, `iterateThreadMembers` |
| Forums | `createForumPost`, `createForumTag`, `editForumTag`, `deleteForumTag`, `forumPostData` |
| Invites | `createInvite`, `invites`, `guildInvites`, `getInvite`, `deleteInvite` |

`channels.create` requires a `GuildChannelType`: `0` text, `2` voice, `4` category, `5` announcement, `15` forum, `16` media or `998` link. Channel create and edit validate the fields exposed by `ChannelEdit` before sending a request.

## Other resources

| Object | Methods |
| --- | --- |
| `client.users` | `get`, `profile`, `createDM`, `application`, `publicApplication`, `editCurrentUser` (rejects for bot tokens), `guilds`, `iterateGuilds`, `leaveGuild` |
| `client.webhooks` | `channel`, `guild`, `create`, `get`, `edit`, `delete`, `execute`, `message`, `editMessage`, `deleteMessage` |
| `client.expressions` | `listEmojis`, `listStickers`, `emoji`, `sticker`, `createEmoji`, `createSticker`, `createEmojis`, `createStickers`, `cloneEmoji`, `cloneSticker`, `renameEmoji`, `editSticker`, `delete`, `metadata`, `source` |
| `client.attachments` | `upload` (direct multipart upload for large files), `refresh` (refresh expiring URLs) |
| `client.commands` | `list`, `get`, `create`, `edit`, `delete`, `clear`, `set` |
| `client.interactions` | `respond`, `defer`, `deferUpdate`, `update`, `autocomplete`, `modal`, `editResponse`, `getResponse`, `deleteResponse`, `followUp` |
| `client.sounds` | `list`, `create`, `edit`, `delete`, `play`, `setGuildNotification`, `clearGuildNotification`, `setChannelNotification`, `clearChannelNotification` |
| `client.rooms` | `stage`, `setStage`, `clearStage`, `stageEffect`, `tournament`, `openTournament`, `reorderTournament`, `startTournament`, `cancelTournament` |
| `client.discovery` | `status`, `apply`, `edit`, `withdraw` |
| `client.media` | builds CDN URLs for avatars, banners, icons, emoji and stickers |

`MicupUserSession` provides user-token profile editing through `editCurrentUser`. `client.users.editCurrentUser` remains as a compatibility shim and rejects without making a request because bot tokens are not accepted by user-session routes.
Command edits validate the supplied partial definition and reject response-only command fields before sending requests.

## Patterns

Paginate with the `iterate*` generators; they follow the cursor rules of each route:

```js
import { AuditAction } from 'micup.ts';

for await (const member of client.guilds.iterateMembers(guildId)) console.log(member.user?.username);
for await (const entry of client.guilds.iterateAuditLog(guildId, { actionType: AuditAction.MemberBanAdd })) console.log(entry.id);
```

Send a message with an embed and an upload:

```js
import { EmbedBuilder } from 'micup.ts';

const upload = await client.attachments.upload(channelId, { name: 'report.txt', data: new Blob(['hello']), description: 'Report' });
await client.sendMessage(channelId, {
  content: 'Report ready',
  embeds: [new EmbedBuilder().title('Report').description('Done').color(0x5865f2).field('Rows', '42', true).build()],
  uploads: [upload],
});
```

Signed attachment uploads require HTTPS. Loopback HTTP URLs are accepted for local testing; public HTTP URLs are rejected before file data is sent.

Clear a nullable field by passing `null` (for example `setNickname(guildId, null)` or `edit(channelId, { topic: null })`); leave a field out to keep it.

Call a route the SDK has no method for with `client.request(method, path, { body, query, reason, signal })`. Paths are relative to the versioned API.

## Sound and rooms

Upload a soundboard sound as bytes or base64 (MP3 or Ogg, up to 512000 bytes and 5.2 seconds), then play it while the bot is in the voice channel:

```js
import { readFile } from 'node:fs/promises';

const sound = await client.sounds.create(guildId, { name: 'airhorn', audio: await readFile('airhorn.mp3'), volume: 0.8 });
await client.sounds.play(channelId, sound.id, { sessionId: session.sessionId, connectionId: grant.connection_id });
```

Run the room stage of a voice channel (the service must have room stages switched on, and the bot needs `ManageRoomStage`):

```js
await client.rooms.setStage(channelId, {
  tv: { type: 'board', title: 'Scores', scores: [{ name: 'Ada', value: 12 }] },
  host: { character: 'ithp-gunluk' },
  ttl_seconds: 600,
});
await client.rooms.stageEffect(channelId, { type: 'confetti' });
```
