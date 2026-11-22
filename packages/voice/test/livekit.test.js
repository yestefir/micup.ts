import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { once } from 'node:events';
import { test } from 'node:test';
import { bytesPerFrame, channels, Player, sampleRate, VoiceRoom } from '@micupts/voice';

const endpoint = process.env.MICUP_TEST_LIVEKIT_ENDPOINT;

function devToken(identity, room) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const header = encode({ alg: 'HS256', typ: 'JWT' });
  const claims = encode({
    iss: 'devkey', sub: identity, nbf: now - 30, exp: now + 60,
    video: { roomJoin: true, room, canPublish: true, canSubscribe: true },
  });
  const payload = header + '.' + claims;
  return payload + '.' + createHmac('sha256', 'secret').update(payload).digest('base64url');
}

test('publishes audible PCM to a subscriber on a local LiveKit server', {
  skip: !endpoint,
  timeout: 20_000,
}, async () => {
  const sdk = await import('@livekit/rtc-node');
  const endpointUrl = new URL(endpoint);
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(endpointUrl.hostname));
  const signal = AbortSignal.timeout(15_000);
  const roomName = 'micuptest-' + process.pid;
  const subscriber = new sdk.Room();
  let publisher;
  let playback;
  let reader;
  const stop = new AbortController();

  try {
    await subscriber.connect(endpoint, devToken('receiver', roomName), { autoSubscribe: true, dynacast: false });
    const subscribed = once(subscriber, sdk.RoomEvent.TrackSubscribed, { signal });
    subscribed.catch(() => {});
    publisher = await VoiceRoom.connect({ endpoint, token: devToken('sender', roomName) }, { signal });
    const pcm = async function* () {
      let sample = 0;
      for (let i = 0; i < 250; i++) {
        const frame = Buffer.alloc(bytesPerFrame);
        for (let offset = 0; offset < frame.length; offset += channels * 2) {
          const value = Math.round(Math.sin(2 * Math.PI * 440 * sample++ / sampleRate) * 9000);
          frame.writeInt16LE(value, offset);
          frame.writeInt16LE(value, offset + 2);
        }
        yield frame;
      }
    };
    playback = new Player(publisher).play(pcm(), { signal: AbortSignal.any([signal, stop.signal]) });
    playback.catch(() => {});
    const [track] = await subscribed;
    reader = new sdk.AudioStream(track, { sampleRate, numChannels: channels, frameSizeMs: 20 }).getReader();
    const cancel = () => { void reader.cancel().catch(() => {}); };
    signal.addEventListener('abort', cancel, { once: true });
    try {
      let audible = false;
      while (!audible && !signal.aborted) {
        const next = await reader.read();
        if (next.done) break;
        audible = next.value.data.some((sample) => Math.abs(sample) > 500);
      }
      assert.equal(audible, true, 'LiveKit subscriber did not receive non-silent audio');
    } finally {
      signal.removeEventListener('abort', cancel);
    }
  } finally {
    stop.abort();
    await playback?.catch(() => {});
    await reader?.cancel();
    await publisher?.close();
    await subscriber.disconnect();
    await sdk.dispose();
  }
});
