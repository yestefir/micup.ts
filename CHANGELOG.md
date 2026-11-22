# Changelog

## Unreleased

- Added `client.sounds` for guild soundboard sounds, playback in a voice channel and guild or channel notification sounds, and the `GUILD_SOUNDBOARD_SOUNDS_UPDATE` and `GUILD_SOUNDBOARD_SOUND_PLAY` events.
- Added `client.discovery` to read, apply for, edit and withdraw a guild discovery listing.
- Added `client.rooms` for the voice room stage (board, video, host and effects) and room tournaments, and the `ManageRoomStage` permission.
- Added guild `vanityUrl`, `editVanityUrl`, `role`, `getBan`, `findMembers`, `moveChannels`, `editCurrentMember`, `setNickname`, `transferOwnership` and `deleteOwnMessages`.
- Added channel `addRecipient`, `removeRecipient`, `deleteOwnMessages`, `crosspostSource`, `archiveThread` and `lockThread`.
- Added `expressions.emoji`, `sticker` and `source`, `commands.clear`, `users.editCurrentUser` and `users.publicApplication`.
- Added `MicupErrorCode`, including the new DM quota and spam codes, and `notFound`, `forbidden`, `rateLimited` and `hasFieldCode()` on `MicupAPIError`.
- Added `client.self`, `client.application()`, `client.applicationId()`, `client.tokenId` and `tokenId()`.
- Added the `logger` option that reports requests the bot lacks permission for, once a minute per route.
- Added `iterateMembers`, `iterateAuditLog`, `iteratePins` and `iterateThreadMembers`, `background()`, `client.suppressEmbeds()` and `MessageFlag`.

## 1.0.0

- Added Micup endpoint discovery, authenticated REST requests, rate-limit handling, message editing and pagination, and multipart attachments.
- Added reconnecting Gateway sessions, heartbeat acknowledgements, replay, shard routing, presence and member or count requests.
- Added a guild state cache with channel and thread lookups and permission evaluation.
- Added slash and context menu commands, interaction routing, autocomplete, modals, deferred replies and follow-ups.
- Added channel, thread, member, role, moderation, invite, pin and reaction operations.
- Added Gateway voice grants and the separate `@micupts/voice` package for outgoing LiveKit audio with an FFmpeg source and a PCM player.
