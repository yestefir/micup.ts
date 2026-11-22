# Voice

Micup carries voice over LiveKit. micup.ts joins a voice channel through the Gateway and gives you a short-lived grant; the optional [`@micup.ts/voice`](../packages/voice) package connects to LiveKit with that grant and publishes audio.

```sh
npm install @micup.ts/voice
```

Install FFmpeg to decode files, URLs and streams. You can skip it if you only play raw PCM. The package supports unencrypted rooms; a grant with `e2ee_key` or `p2p` is refused.

## Play audio

`VoiceConnection` joins, connects, owns a player and leaves when it closes.

```js
import { VoiceConnection } from '@micup.ts/voice';

const session = client.newSession({
  handler: events.handle,
  onVoiceGrant: (grant) => connections.get(grant.guild_id)?.regrant(grant),
});
void session.run({ signal: stop.signal });

const connection = await VoiceConnection.connect(session, guildId, channelId, { selfDeaf: true, volume: 0.8 });
connections.set(guildId, connection);
connection.on('finish', ({ stopped }) => console.log(stopped ? 'stopped' : 'ended'));
await connection.play('./song.mp3');
await connection.disconnect();
```

Wait for the session to be ready before you connect. The bot needs `Connect` and `Speak` in the channel.

### Play options

`play(input, options)` takes a file path, an `http(s)` URL or a `Readable`.

| Option | Meaning |
| --- | --- |
| `volume` | 0 to 2 for this track |
| `seek` | start position in seconds |
| `ffmpegArgs` | extra FFmpeg arguments inserted before the output, for example `['-af', 'bass=g=5']`; treat them as trusted input |
| `ffmpeg` | path of the FFmpeg binary; `FFMPEG_PATH` and `PATH` are used otherwise |
| `raw` | the input is 48 kHz stereo signed 16-bit PCM, from a stream or an async iterable, and FFmpeg is not used |
| `signal` | abort the track |

URLs reconnect automatically after a dropped connection. A new `play()` replaces the current track.

### Controls and events

`stop()`, `pause()`, `resume()` and `setVolume(0..2)` act on the current track. `playing`, `paused`, `volume`, `status`, `memberCount`, `guildId`, `channelId` and `connectionId` report state.

| Event | When |
| --- | --- |
| `start` | a track starts |
| `finish` | a track ends; `{ stopped: true }` when it was stopped or replaced |
| `status` | `connecting`, `ready`, `reconnecting` or `disconnected` |
| `memberJoin`, `memberLeave` | another participant joins or leaves the room |
| `disconnect` | the connection closed; the second argument is the reason |
| `error` | a source failed; the promise of `play()` rejects as well |

If the LiveKit room drops, the connection leaves the channel and emits `disconnect`. Use it to reconnect or to leave empty channels.

## Move between channels

When the bot is moved, the Gateway sends a new grant. Pass it to `regrant()`; it stops the current track, closes the old room and connects to the new one, and the volume stays.

```js
const session = client.newSession({
  handler: events.handle,
  onVoiceGrant: (grant) => connections.get(grant.guild_id)?.regrant(grant),
  onVoiceLost: (guildId, connectionId) => connections.delete(guildId),
  onVoiceEmpty: (guildId, channelId) => connections.get(guildId)?.disconnect(),
});
```

`onVoiceEmpty` fires when the last other member leaves the bot's channel.

## Lower level

`VoiceRoom.connect(grant)` connects without the player; it emits `memberJoin`, `memberLeave` and `disconnected` and gives `openTrack()` for several independent tracks. `Player` plays any PCM source on a track, with `pause()`, `resume()`, `skip()` and `setVolume()`. `openSource(input, options)` decodes with FFmpeg. See the [package README](../packages/voice/README.md).

## Soundboard

Guild soundboard sounds play in the voice channel the bot is in. Upload and play with `client.sounds`:

```js
const sound = await client.sounds.create(guildId, { name: 'airhorn', audio: await readFile('airhorn.mp3') });
await client.sounds.play(channelId, sound.id, { sessionId: session.sessionId, connectionId: connection.connectionId });
```

Sounds are MP3 or Ogg, at most 512000 bytes and 5.2 seconds. The `GUILD_SOUNDBOARD_SOUNDS_UPDATE` and `GUILD_SOUNDBOARD_SOUND_PLAY` events report changes and playback. Guild and channel notification sounds are set with `setGuildNotification()` and `setChannelNotification()`.

## Voice rooms

`client.rooms` runs the 3D room of a voice channel: `setStage()` shows a board or a YouTube video on the room TV and a host character, `stageEffect()` sends confetti, a spotlight or a host emote, and `openTournament()`, `reorderTournament()`, `startTournament()` and `cancelTournament()` run a 1v1 tournament. The bot needs `ManageRoomStage` and the service must have the feature on; otherwise requests answer `403 FEATURE_TEMPORARILY_DISABLED`.
