# @micupts/voice

Outgoing audio for [micup.ts](https://github.com/yestefir/micup.ts) bots. The package publishes stereo audio to a LiveKit room using a short-lived Micup voice grant.

Requires Node.js 22 or later. Install FFmpeg to decode an audio file or stream with `openSource`. You can also give `Player` an async iterable of raw signed 16-bit little-endian PCM bytes at 48 kHz stereo.

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

The grant accepts the `endpoint` and `token` from a Micup Gateway voice-server update. Keep grants out of logs and persistent storage. The publisher supports unencrypted LiveKit rooms. The player supports pause, resume, skip and volume. Queue and playlist management belong to the application.
