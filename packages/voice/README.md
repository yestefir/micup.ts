# @micupts/voice

Outgoing audio for [micup.ts](https://github.com/yestefir/micup.ts) bots. The package publishes stereo audio to a LiveKit room using a short-lived Micup voice grant.

Install with `npm install @micupts/voice`. Requires Node.js 22 or later. Install FFmpeg to decode an audio file or stream with `openSource`. You can also give `Player` an async iterable of raw signed 16-bit little-endian PCM bytes at 48 kHz stereo.

```js
import { openSource, Player, VoiceRoom } from '@micupts/voice';

export async function playAudio(grant, input, signal) {
  const room = await VoiceRoom.connect(grant, { signal, bitrate: 64000 });
  try {
    const source = openSource(input, { signal });
    try {
      const player = new Player(room);
      await player.play(source, { signal });
    } finally {
      await source.close();
    }
  } finally {
    await room.close();
  }
}
```

Use the Gateway session to obtain a grant before connecting the audio publisher:

```js
const grant = await session.joinVoice(guildId, channelId, { selfDeaf: true, signal });
try {
  await playAudio(grant, input, signal);
} finally {
  await session.leaveVoice(guildId, grant.connection_id);
}
```

The grant accepts the `endpoint` and `token` from a Micup Gateway voice-server update. Keep grants out of logs and persistent storage. The publisher supports unencrypted LiveKit rooms. The player supports pause, resume, skip and volume. Queue and playlist management belong to the application.

## Track lifecycle

`VoiceRoom.connect()` publishes a default track. Pass `publishOnConnect: false` to connect first and call `room.openTrack()` when you are ready to publish. A track can be closed independently of its room. Use `Player.playing` and `Player.paused` to inspect playback. Skipping stops the current source and clears queued PCM.

## Local LiveKit test

Start a LiveKit server in development mode on loopback. Set `MICUP_TEST_LIVEKIT_ENDPOINT` to its WebSocket URL and run `npm test --workspace @micupts/voice`. The integration test publishes an audible PCM signal and verifies that a second participant receives it.

Set `MICUP_TEST_FFMPEG` to an FFmpeg binary to run that test with a decoded WAV source.
