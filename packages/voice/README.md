# @micup.ts/voice

Voice for [micup.ts](https://github.com/yestefir/micup.ts) bots. It joins a voice channel through the Micup Gateway, connects to the channel's LiveKit room with a short-lived grant, and publishes stereo audio from files, URLs, streams or raw PCM.

```sh
npm install @micup.ts/voice
```

Requires Node.js 20.3 or later. Install [FFmpeg](https://ffmpeg.org) to decode files, URLs and streams; it is not needed for raw PCM. Check it with `ffmpeg -version`, or point to a binary with the `FFMPEG_PATH` environment variable or the `ffmpeg` option. Rooms with end-to-end encryption or peer-to-peer voice are not supported, and such grants are refused.

## Installing FFmpeg

| System | Command |
| --- | --- |
| Windows | `winget install Gyan.FFmpeg` (or `choco install ffmpeg`), then reopen the terminal |
| macOS | `brew install ffmpeg` |
| Debian and Ubuntu | `sudo apt install ffmpeg` |
| Docker | install `ffmpeg` in the image, for example `apt-get install -y ffmpeg` |

If FFmpeg cannot be started, `play()` and `openSource()` fail with an error that says so and names `FFMPEG_PATH`; the original process error is available as `cause`. Errors from a readable input stream are reported as `Audio input stream failed` with the stream error in `cause`. A failed `VoiceRoom.connect()` reports the LiveKit error in `cause`.

## Quick start

```js
import { MicupClient } from 'micup.ts';
import { VoiceConnection } from '@micup.ts/voice';

const client = await MicupClient.connect({ token: process.env.MICUP_BOT_TOKEN });
const connections = new Map();
const session = client.newSession({
  handler: events.handle,
  onVoiceGrant: (grant) => connections.get(grant.guild_id)?.regrant(grant),
  onVoiceLost: (guildId) => connections.delete(guildId),
});
void session.run({ signal: stop.signal });

const connection = await VoiceConnection.connect(session, guildId, channelId, { selfDeaf: true, volume: 0.8 });
connections.set(guildId, connection);
connection.on('finish', ({ stopped }) => console.log(stopped ? 'stopped' : 'ended'));
await connection.play('./song.mp3');
await connection.disconnect();
```

Wait until the session is ready before you connect. The bot needs `Connect` and `Speak` in the channel.

## VoiceConnection

`VoiceConnection.connect(session, guildId, channelId, options)` joins the channel, connects to LiveKit, owns a player and leaves the channel when it closes.

| Option | Meaning |
| --- | --- |
| `selfMute`, `selfDeaf` | the bot's voice state |
| `volume` | starting volume, 0 to 2 |
| `bitrate` | Opus bitrate in bits per second (8000 to 512000, default 96000) |
| `trackName` | name of the published LiveKit track |
| `signal` | cancels joining and connecting |

| Member | Meaning |
| --- | --- |
| `play(input, options)` | play a file path, an `http(s)` URL or a `Readable`; replaces the current track |
| `stop()`, `pause()`, `resume()`, `setVolume(0..2)` | control the current track |
| `regrant(grant)` | move to the channel of a new voice grant; stops the track and keeps the volume |
| `disconnect()` | close the room and leave the channel; safe to call twice |
| `status`, `playing`, `paused`, `volume`, `memberCount`, `guildId`, `channelId`, `connectionId`, `destroyed` | state |

`play()` options: `volume`, `seek` (seconds), `ffmpegArgs` (extra arguments inserted before the output, for example `['-af', 'bass=g=5']`; treat as trusted input), `ffmpeg` (binary path), `raw` (the input is 48 kHz stereo signed 16-bit little-endian PCM from a stream or an async iterable) and `signal`.

| Event | When |
| --- | --- |
| `start` | a track starts |
| `finish` | a track ends; `{ stopped: true }` when it was stopped, replaced or aborted |
| `status` | `connecting`, `ready`, `reconnecting` or `disconnected` |
| `memberJoin`, `memberLeave` | another participant joins or leaves the room |
| `disconnect` | the connection closed; the argument is the reason, if any |
| `error` | a source failed; the promise of `play()` rejects as well |

A dropped LiveKit room closes the connection, leaves the channel and emits `disconnect`. Listener exceptions never escape `emit()`; synchronous throws and rejected listener promises are sent to `error` listeners when present. The `error` event is only emitted when you listen for it.

When the bot is moved, the Gateway sends a new grant to `onVoiceGrant`. `regrant()` stops the current track, closes the old room and connects to the new one.

## Lower level

```js
import { openSource, Player, VoiceRoom } from '@micup.ts/voice';

const room = await VoiceRoom.connect(grant, { signal, bitrate: 64000 });
try {
  const source = openSource(input, { signal, startSeconds: 30 });
  try {
    await new Player(room).play(source, { signal });
  } finally {
    await source.close();
  }
} finally {
  await room.close();
}
```

| Export | Purpose |
| --- | --- |
| `VoiceRoom` | connects with a grant, publishes a default track, `openTrack()` for more tracks, emits `memberJoin`, `memberLeave` and `disconnected`, reports `memberCount` |
| `VoiceTrack` (type) | one published audio track; can be closed independently of its room |
| `Player` | plays PCM on a track with `pause()`, `resume()`, `skip()`, `setVolume()`, `playing`, `paused` |
| `openSource()` | decodes a file, URL or stream with FFmpeg into PCM; options `ffmpeg`, `startSeconds`, `ffmpegArgs`, `signal` |
| `PlaybackSkippedError`, `PlaybackBusyError` | thrown by `Player` |
| `TypedEmitter` | the small event emitter `VoiceRoom` and `VoiceConnection` build on |
| `sampleRate`, `channels`, `frameDurationMs`, `samplesPerFrame`, `bytesPerFrame`, `scaleVolume()` | PCM constants and helpers |

`VoiceRoom.connect()` publishes a default track. Pass `publishOnConnect: false` to connect first and call `room.openTrack()` when you are ready. Skipping stops the current source and clears queued audio. Queues and playlists belong to your application.

The grant accepts the `endpoint` and `token` from a Micup Gateway voice-server update. Keep grants out of logs and persistent storage.

## Soundboard and rooms

Guild soundboard sounds and the 3D voice room stage are part of the main package: see `client.sounds` and `client.rooms` in the [micup.ts documentation](https://github.com/yestefir/micup.ts/blob/main/docs/voice.md).

## Tests

`npm test --workspace @micup.ts/voice` runs the unit tests. To run the integration test, start a LiveKit server in development mode on loopback and set `MICUP_TEST_LIVEKIT_ENDPOINT` to its WebSocket URL; the test publishes an audible PCM signal and verifies that a second participant receives it. Set `MICUP_TEST_FFMPEG` to an FFmpeg binary to run it with a decoded WAV source.

MIT license.
