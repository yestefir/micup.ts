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

## `client.guilds`

| Group | Methods |
| --- | --- |
| Server | `get`, `edit`, `channels`, `moveChannels`, `vanityUrl`, `editVanityUrl`, `transferOwnership`, `deleteOwnMessages`, `auditLog`, `iterateAuditLog` |
| Roles | `roles`, `role`, `createRole`, `editRole`, `deleteRole`, `moveRoles`, `moveHoistedRoles`, `resetHoistedRoles` |
| Members | `member`, `currentMember`, `members`, `iterateMembers`, `editMember`, `editCurrentMember`, `setNickname`, `addMemberRole`, `removeMemberRole`, `kick`, `timeout`, `clearTimeout`, `findMembers`, `searchMembers` |
| Bans | `bans`, `getBan`, `ban`, `unban` |

## `client.channels`

| Group | Methods |
| --- | --- |
| Channels | `get`, `create`, `edit`, `delete`, `setPermission`, `deletePermission`, `addRecipient`, `removeRecipient`, `follow`, `followerStats`, `crosspostSource`, `deleteOwnMessages` |
| Pins and reactions | `pin`, `unpin`, `pins`, `iteratePins`, `addReaction`, `removeReaction`, `deleteReaction`, `reactionUsers`, `iterateReactionUsers` |
| Threads | `startThread`, `activeThreads`, `archivedThreads`, `searchThreads`, `joinThread`, `leaveThread`, `archiveThread`, `lockThread`, `addThreadMember`, `removeThreadMember`, `threadMember`, `threadMembers`, `iterateThreadMembers` |
| Forums | `createForumPost`, `createForumTag`, `editForumTag`, `deleteForumTag`, `forumPostData` |
| Invites | `createInvite`, `invites`, `guildInvites`, `getInvite`, `deleteInvite` |

## Other resources

| Object | Methods |
| --- | --- |
| `client.users` | `get`, `profile`, `createDM`, `application`, `publicApplication`, `editCurrentUser` (username, avatar, banner), `guilds`, `iterateGuilds`, `leaveGuild` |
| `client.webhooks` | `channel`, `guild`, `create`, `get`, `edit`, `delete`, `execute`, `message`, `editMessage`, `deleteMessage` |
| `client.expressions` | `listEmojis`, `listStickers`, `emoji`, `sticker`, `createEmoji`, `createSticker`, `createEmojis`, `createStickers`, `cloneEmoji`, `cloneSticker`, `renameEmoji`, `editSticker`, `delete`, `metadata`, `source` |
| `client.attachments` | `upload` (direct multipart upload for large files), `refresh` (refresh expiring URLs) |
| `client.commands` | `list`, `get`, `create`, `edit`, `delete`, `clear`, `set` |
| `client.interactions` | `respond`, `defer`, `deferUpdate`, `update`, `autocomplete`, `modal`, `editResponse`, `getResponse`, `deleteResponse`, `followUp` |
| `client.sounds` | `list`, `create`, `edit`, `delete`, `play`, `setGuildNotification`, `clearGuildNotification`, `setChannelNotification`, `clearChannelNotification` |
| `client.rooms` | `stage`, `setStage`, `clearStage`, `stageEffect`, `tournament`, `openTournament`, `reorderTournament`, `startTournament`, `cancelTournament` |
| `client.discovery` | `status`, `apply`, `edit`, `withdraw` |
| `client.media` | builds CDN URLs for avatars, banners, icons, emoji and stickers |

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
