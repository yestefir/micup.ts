# Changelog

## 1.2.0 - 2026-11-22

- `client.newSession()` and the shard manager accept a `logger` option that reports Gateway readiness, resumes, invalidated sessions and disconnects (close code, whether it reconnects) with the shard number. This matches `SessionOptions.Logger` of micup.go.
- `MicupLogger` has an optional `info` method next to `warn`.
- Package metadata: `main` and `types` fallbacks, `sideEffects: false` and a bug tracker URL.
- `@micup.ts/voice` 1.1.1: a rewritten README with the full API of `VoiceConnection` and the lower-level exports, and the same metadata.

## 1.1.1 - 2026-11-22

- The voice package moved to the `@micup.ts` scope: install `@micup.ts/voice` instead of `@micupts/voice`. The code is the same as `@micupts/voice` 1.1.0, and the README and guides point to the new name.

## 1.1.0 - 2026-11-22

### New resources

- `client.sounds`: guild soundboard sounds, playback in a voice channel, and guild or channel notification sounds. The `GUILD_SOUNDBOARD_SOUNDS_UPDATE` and `GUILD_SOUNDBOARD_SOUND_PLAY` events are typed.
- `client.rooms`: the voice room stage (board or video on the room TV, host character, effects) and room tournaments. New `ManageRoomStage` permission.
- `client.discovery`: read, apply for, edit and withdraw a server discovery listing.

### Servers, channels and users

- Guilds: `vanityUrl`, `editVanityUrl`, `role`, `getBan`, `findMembers`, `moveChannels`, `editCurrentMember`, `setNickname`, `transferOwnership`, `deleteOwnMessages`.
- Channels: `addRecipient`, `removeRecipient`, `deleteOwnMessages`, `crosspostSource`, `archiveThread`, `lockThread`.
- `expressions.emoji`, `sticker` and `source`; `commands.clear`; `users.editCurrentUser` and `users.publicApplication`; `client.suppressEmbeds()`.
- Paging generators: `iterateMembers`, `iterateAuditLog`, `iteratePins`, `iterateThreadMembers`.

### Reliability and diagnostics

- `MicupErrorCode` (including the DM quota and spam codes) and `notFound`, `forbidden`, `rateLimited` and `hasFieldCode()` on `MicupAPIError`.
- `client.self`, `client.application()`, `client.applicationId()`, `client.tokenId` and `tokenId()`.
- The `logger` option reports requests the bot lacks permission for, once a minute per route.
- `background()` runs slow work outside a Gateway handler with a timeout and a contained error.

### Helpers and typings

- Constant groups: `ChannelType`, `AuditAction`, `GuildFeature`, `MessageType`, `UserFlag`, `GatewayCloseCode`, `Limits` and more, generated from micup.go. `MessageFlag` is exported.
- Builders: `primaryButton`, `secondaryButton`, `successButton`, `dangerButton`, `linkButton`, `stringSelect`, `userSelect`, `roleSelect`, `mentionableSelect`, `channelSelect`, `shortInput`, `paragraphInput`, `disableButtons`, `imageData`.
- Readers: `optionString`, `optionInteger`, `optionMember`, `focusedOption`, `targetUser`, `modalValue`, `selectedUsers` and related, plus `isButtonInteraction`, `isSelectInteraction`, `isDMChannel`, `isThreadChannel`, `memberTimedOut`, `guildHasFeature`.
- Permissions: `permissionNames`, `parsePermission`, `missingPermissions`, `ElevatedPermissions`.
- The message, user, attachment, channel, member, role, guild and embed typings carry the fields micup.go decodes.

### @micupts/voice 1.1.0

- `VoiceConnection`: joins, connects, plays and leaves; emits `start`, `finish`, `status`, `memberJoin`, `memberLeave`, `disconnect` and `error`; `regrant()` follows a bot that is moved; plays files, URLs, streams and raw PCM.
- `VoiceRoom` emits `memberJoin`, `memberLeave` and `disconnected` and reports `memberCount`.
- `openSource()` accepts `ffmpegArgs`, a `Readable` input and the `FFMPEG_PATH` environment variable, and HTTP inputs reconnect after a dropped connection.
- Fixed `Player.skip()` rejecting with an `AbortError` instead of `PlaybackSkippedError` while the player waits for the next frame.

### Documentation

- A rewritten README, a Turkish README, and guides for getting started, commands and interactions, the Gateway and sharding, the REST reference, voice, errors and limits, and migration from micup.js, micup.gg.js and discord.js.

## 1.0.0

- Added Micup endpoint discovery, authenticated REST requests, rate-limit handling, message editing and pagination, and multipart attachments.
- Added reconnecting Gateway sessions, heartbeat acknowledgements, replay, shard routing, presence and member or count requests.
- Added a guild state cache with channel and thread lookups and permission evaluation.
- Added slash and context menu commands, interaction routing, autocomplete, modals, deferred replies and follow-ups.
- Added channel, thread, member, role, moderation, invite, pin and reaction operations.
- Added Gateway voice grants and the separate `@micupts/voice` package for outgoing LiveKit audio with an FFmpeg source and a PCM player.
