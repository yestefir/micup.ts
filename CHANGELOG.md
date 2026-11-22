# Changelog

## Unreleased

- Remove banned users from the member inventory during and after synchronization.

## 2.0.0 - 2026-11-22

- Require Node.js 24 or later in both packages and run CI against supported Node.js 24 and 26 releases. Node.js 20 and 22 are end-of-life.
- Limit discovery document responses to 64 KiB and share bounded JSON parsing with REST responses.
- Preserve discovery HTTP errors even when cancelling a rejected response body fails.
- Reject unsupported and response-only fields in root slash-command definitions before sending requests.
- Require string names in slash-command and option definitions before validating their character rules.
- Validate command option entries before inspecting their structure, including null and sparse entries.
- Reject non-object command localization maps instead of silently omitting them.
- Reject unsupported fields in soundboard sound create and edit requests.

- Extend the sandbox live smoke checks with an optional read-only user-token identity check.
- Forum post creation rejects unsupported nonce and boolean message fields based on field presence, including false and zero values.

- Added a separate user-token REST session for current-user profile edits; the bot client's old profile method now rejects locally instead of sending a request that rejects bot credentials.
- Discovery create and edit requests reject response-only fields and empty edits before sending.
- Invite, ban and expression creation requests reject unsupported fields before sending.
- Voice-room stage, effect and tournament requests validate and serialize supported nested fields only.
- Webhook edits reject unsupported fields and invalid avatar values before sending.
- Channel and role ordering requests reject duplicate IDs, invalid positions and unsupported fields.
- Channel, thread, forum tag and permission overwrite requests reject unsupported fields and out-of-range permission bits.
- Guild role and member updates reject fields that belong to API responses or another route.
- Message requests and attachment references reject unsupported fields and serialize metadata explicitly.
- Embed request and response types are distinct; embed inputs validate nested fields and URL protocols.
- Message creation supports sending a saved meme by its favorite meme ID.
- Message nonces support documented numeric and string forms and retry correctly when the nonce is zero.
- Easy client Gateway events no longer use unbounded event payload types; guild updates require both API identifiers.
- TypeScript compilation enables unchecked indexed access across the main and voice packages.
- Guild member search validates documented sort fields, source types and timestamp ranges before sending requests.
- Command option validation checks booleans, numeric and string constraints, channel filters and nested response-only fields.
- Live smoke checks read the bot's first guild, its channels, roles and current member when available.
- Command edits validate partial command definitions and reject response-only fields.
- Guild updates expose a dedicated `GuildEdit` request type and validate editable fields before sending requests.
- Sticker updates require description and tags so omitted values cannot be cleared accidentally.

### Reliability and security

- REST and Gateway connection errors retain their original causes; attachment upload and LiveKit connection failures do the same. FFmpeg startup and input stream errors retain their underlying causes, and stream listeners are removed when the process closes.
- Live smoke checks require an explicit sandbox origin and never default to production.
- REST accepts HTTP-date `Retry-After` values, rejects dot-segment paths, discards malformed API field errors, bounds learned route and bucket tables, and masks webhook and interaction tokens in permission logs.
- REST preserves the caller's abort reason when cancellation interrupts a successful response body.
- Compressed Gateway sends stop promptly when aborted during a flush; an interrupted caller send also closes the connection so later packets cannot reuse a desynchronized compression stream.
- Gateway guild snapshots replace cached members so stale members cannot affect lookups or permission checks after a sync.
- Gateway permission lookups retain the guild owner override when a partial snapshot omits role data.
- Voice joins are serialized within a Gateway session because refusal opcodes do not identify a guild or request.
- Voice playback waits for asynchronous PCM source cleanup when playback is cancelled, keeps the player busy during cleanup, and closes connection-owned sources only once.
- Voice connection regrants run sequentially so overlapping Gateway updates cannot leave an older LiveKit room active.
- Easy Client destruction aborts an in-progress REST connection attempt during login.
- Easy Client clears partial shard readiness before each login attempt so a retry waits for every shard again.
- Easy Client clears readiness timestamps on destroy while retaining its authenticated bot identity.
- Easy Client destruction rejects pending interaction waiters instead of leaving them unresolved.
- Errors from `awaitInteraction()` filters reject only their waiter and do not suppress normal interaction routing.
- `awaitInteraction()` validates filters and timer durations before registering a waiter.
- Easy Client preserves duplicate listener registrations independently so `once()` remains one-shot alongside `on()`.
- Voice event emitters preserve duplicate listener registrations independently, including one-shot listeners.
- Voice track publishing cleans up created tracks when the LiveKit publisher throws synchronously.
- Voice room connections clean up the room when LiveKit throws synchronously during connect.
- REST validates forum tag IDs, archived thread kinds, reaction-user cursors, discovery and sticker tags, message mention rules, sticker IDs and attachment references before sending requests.
- REST validates forum tag names, moderation flags and emoji field shapes before sending requests.
- Discovery applications validate supported categories, languages and custom tag characters before sending requests.
- Discovery application status types retain known-value autocomplete while accepting new server statuses.
- Thread creation validates slowmode, type and invitable fields before sending requests.
- Invite creation validates expiry, use-count and boolean options before sending requests.
- Channel creation requires a supported guild channel type and validates shared field ranges before sending requests.
- Single channel permission overwrites use the same target, type and permission-bit validation as channel creation.
- Role creation and edits validate names, colors, booleans and unsigned 64-bit permission masks before sending requests.
- Bot profile updates reject non-string usernames and malformed avatar or banner values before sending requests.
- Guild member updates validate roles, nicknames, voice fields, timeout dates and profile values before sending requests.
- Raw REST requests validate methods, query objects and retry/authentication flags, and reject GET or HEAD bodies before sending requests.
- Guild channel moves reject sparse position arrays instead of serializing holes as null values.
- Room tournament ordering rejects sparse entrant arrays before building the request body.
- Bulk deletion, forum thread-data, OAuth invite and message-forward arrays reject malformed and sparse values before sending requests.
- Command localization rejects sparse command, option and choice arrays instead of preserving holes in the localized output.
- Component-disabling helpers reject sparse row and component arrays instead of preserving holes in the output.
- Easy command builders validate choice and channel-type arrays before building command definitions.
- Message search validates its scalar fields, snowflake filters, string lists, booleans, author types and sort options before sending requests.
- Message file arrays, including sparse arrays, and uploads supplied to `sendMessage`, interaction replies or webhook execution are checked for complete, well-formed metadata before their payload is built.
- Message bodies validate content, embeds, components, flags, nonce and boolean options before serialization.
- Malformed successful REST responses report an SDK error with the JSON parse failure in `cause`.
- Attachment data is sent only to HTTPS upload URLs, except loopback HTTP endpoints used for local testing.
- Attachment upload plans are validated before any signed upload URL receives file data.
- Attachment URL refresh requests and responses are checked for valid array shapes and string values.
- Discovery rejects malformed endpoint documents and URLs before sending the bot token to the API.
- Aborted application metadata lookups do not cancel requests from other callers.
- Client login rejects bot identity responses without a numeric bot ID.
- Easy Client ignores malformed Gateway readiness fields instead of tracking invalid guilds or replacing its bot identity.
- Member inventory lookup failures are reported through the Gateway logger before retrying.
- Background tasks honor a parent signal that was already aborted before the task starts.
- `safeHandler()` contains failures from synchronous and asynchronous error reporters.
- `background()` contains failures from synchronous and asynchronous error reporters.
- Easy Client falls back to its generic interaction reply when a custom error formatter throws.
- Gateway voice grants, FFmpeg executables, readable audio inputs and player PCM sources are validated before use. Abort listener setup is consistent across REST, Gateway and interaction waits.
- Voice source validation rejects sparse FFmpeg argument arrays before starting a process.
- Gateway rejects sparse shard ID, ignored event and subscription member arrays before accepting configuration.
- Gateway rejects configuration fields supplied with the wrong runtime shape, including strings and nested arrays.
- Voice players close PCM sources when cancellation or iterator creation prevents playback from starting.
- Voice players reject PCM sources that yield non-byte chunks instead of silently skipping them.
- Voice `AudioInputStream` describes pipe destinations structurally without exposing `any` or requiring Node.js types in consumer declarations.
- Voice event emitters contain synchronous listener throws and asynchronous listener rejections, forwarding failures to registered `error` listeners.
- Reject null values for user profile mention flags.
- Disable pagination controls when its wait is aborted.
- Validate pagination options before sending the initial page.
- Avoid sending a page when pagination starts with an aborted signal.
- Acknowledge failed lazy page loads and stop pagination without reloading a page.
- Clear cached member and voice state when a guild ban is received.

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
