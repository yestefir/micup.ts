# Changelog

## Unreleased

### Reliability and security

- REST and Gateway connection errors retain their original causes; attachment upload and LiveKit connection failures do the same. FFmpeg startup and input stream errors retain their underlying causes, and stream listeners are removed when the process closes.
- REST accepts HTTP-date `Retry-After` values, rejects dot-segment paths, discards malformed API field errors, bounds learned route and bucket tables, and masks webhook and interaction tokens in permission logs.
- Attachment data is sent only to HTTPS upload URLs, except loopback HTTP endpoints used for local testing.
- Discovery rejects malformed endpoint documents and URLs before sending the bot token to the API.
- Aborted application metadata lookups do not cancel requests from other callers.
- Client login rejects bot identity responses without a numeric bot ID.
- Member inventory lookup failures are reported through the Gateway logger before retrying.
- Background tasks honor a parent signal that was already aborted before the task starts.
- `safeHandler()` contains failures from synchronous and asynchronous error reporters.
- `background()` contains failures from synchronous and asynchronous error reporters.
- Easy Client falls back to its generic interaction reply when a custom error formatter throws.
- Gateway voice grants, FFmpeg executables, readable audio inputs and player PCM sources are validated before use. Abort listener setup is consistent across REST, Gateway and interaction waits.
- Voice event emitters contain synchronous listener throws and asynchronous listener rejections, forwarding failures to registered `error` listeners.

### Compatibility

- CI exercises Node.js 20.20 alongside 22 and 24 on Linux, Windows and macOS.

## 1.3.0 - 2026-11-22

### Compatibility and packaging

- `ws` and `@livekit/rtc-node` use caret ranges (`^8.23.0` and `^1.2.3`), so security patches reach applications without a new release of this SDK and a single copy is shared.
- Node.js 20.3 or later is enough (it was 22). Zstandard Gateway compression still needs 22.15. The test suites pass on Node.js 20.20 and 24, and the native LiveKit module loads on Node.js 20.
- `background()` uses its own timer for `timeoutMs`, so a task that only waits for its timeout is not dropped when nothing else keeps the process alive (Node.js 20 does not keep the event loop alive for `AbortSignal.timeout()`).
- `CHANGELOG.md` is published with the package.
- `@micup.ts/voice` 1.1.2: a missing FFmpeg now fails with a message that explains how to install it or set `FFMPEG_PATH`; the README has installation commands for every system; Node.js 20.3 or later.

### Rate limits and verified bots

- REST requests are paced to at most 45 per second (Micup's global bucket is 50); webhook token requests and interaction callbacks are not counted, as on the server.
- A rejected request guard: 5 rejections (`401`, `403`, `404`) of the same method and path within a minute stop that request for a minute, and 3 rejections of the token block all authenticated requests for a minute, so a bot cannot get an address blocked by repeating rejected requests. `rejectedRequestLimit` changes it (`0` turns it off).
- Gateway: member and count requests are limited to 3 in flight (the server drops sized commands above 4), member requests to 10 per account and 35 per guild per 10 seconds, and a second full member list for a guild within 30 seconds is refused locally with `GatewayRequestError` instead of being sent and dropped.
- A DM compliance suite: a quota that clears within 30 seconds is waited out, a longer one is returned at once, and a spam block is never retried and sends no message.
- A verified bots guide (`docs/verified-bots.md`) that lists every limit and how the SDK handles it.

### Localization

- `localizeCommand(command, catalog, { prefix, strict })` and `localizeCommands()` fill the name, description, option and choice translations of a command from catalog keys (`play.name`, `play.query.description`, `play.mode.choice.loop`, ...). Explicit translations win and the input is not modified.
- `MessageCatalog#resolve(locale)` and `MessageCatalog#has(key)`.
- Command validation names the command, option or choice with a bad translation, drops empty translation maps, and `commands.set()` refuses names that collide once translated. `name_localized` and `description_localized` are typed on the command, option and choice types.
- The easy client takes a `catalog`: it translates commands at login (and edits them when the catalog changes), `interaction.t(key, ...values)` answers in the language of the user, `client.text(locale, key)` and `SlashCommand#localize(catalog)` are available, and the catalog message `error.generic` becomes the private error reply.
- A localization guide (`docs/localization.md`). The SDK checks that locale keys look like language tags and does not list language codes; Micup decides which codes it accepts.

### The easy client

- `micup.ts/easy`: a discord.js-style `Client` on top of the SDK. `new Client()` reads `MICUP_BOT_TOKEN`; `login()` connects, waits for the Gateway and the initial servers, registers commands and emits `ready`. REST-only mode with `gateway: false`; `shards: 'auto'` or a number for sharding.
- Events: `messageCreate`, `messageUpdate`, `messageDelete`, `interactionCreate`, guild, member, ban, channel, reaction and voice events with wrapped objects, plus every raw Gateway event by name. Errors in listeners are emitted as `error` and never crash the bot or replay the event.
- Objects with methods: `User`, `Member`, `Guild`, `Channel`, `Message` (`reply`, `edit`, `delete`, `react`, `pin`, ...).
- Interactions: `CommandInteraction`, `AutocompleteInteraction`, `ComponentInteraction`, `ModalSubmitInteraction` with `reply`, `deferReply`, `editReply`, `followUp`, `update`, `showModal`, `respond`, typed option readers (`getString`, `getInteger`, `getMember`, ...), and `InteractionRepliedError` for double answers.
- `SlashCommand` builder (options, subcommands, groups, choices, localizations), `userCommand()`, `messageCommand()` and `modal()`.
- `client.command()`, `client.component()`, `client.modal()` and `client.autocomplete()` route interactions by command path, exact id, prefix (`vote:*`) or pattern. `registerCommands()` creates, edits and optionally prunes commands, and runs at login.
- A routed handler that fails before answering sends a private error reply (`errorReply` option).
- `paginate(target, pages, options)`: a button-driven page viewer for a command, a component or a message, with lazy pages, jump buttons, an invoker-only guard and idle timeout.
- `awaitInteraction()`, `setStatus()`, `setCustomStatus()`, `setPresence()`, `permissionsFor()`, `sessionFor()` and `handleDispatch()`.
- `micup.ts/easy` re-exports everything in `micup.ts`; `client.rest` is the full SDK client.

## 1.2.0 - 2026-11-22

- `client.newSession()` and the shard manager accept a `logger` option that reports Gateway readiness, resumes, invalidated sessions and disconnects (close code, whether it reconnects) with the shard number. This matches `SessionOptions.Logger` of micup.go.
- `MicupLogger` has an optional `info` method next to `warn`.
- Fixed: `EventMux` handlers can return any value, so `(interaction, event, signal) => router.handle(interaction, signal)` type-checks.
- Fixed: `GatewaySession` can be passed to `VoiceConnection.connect()` in TypeScript (the `leaveVoice` signature of `VoiceSessionLike` matched the wrong shape).
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
