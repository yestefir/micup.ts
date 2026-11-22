import assert from 'node:assert/strict';
import { test } from 'node:test';
import { VoiceRoom, openSource } from '@micup.ts/voice';

test('rejects unsupported LiveKit grants and nonlocal cleartext endpoints', async () => {
  await assert.rejects(
    VoiceRoom.connect({ endpoint: 'voice.example', token: 'fixture', e2ee_key: 'fixture' }),
    /unencrypted Micup voice/,
  );
  await assert.rejects(
    VoiceRoom.connect({ endpoint: 'ws://voice.example', token: 'fixture' }),
    /Invalid LiveKit endpoint/,
  );
});

test('reports a missing FFmpeg binary instead of treating it as end of audio', async () => {
  const source = openSource('fixture.wav', { ffmpeg: 'micupts-fixture-decoder-not-installed' });
  const consume = async () => {
    for await (const chunk of source) assert.fail(String(chunk));
  };
  await assert.rejects(consume(), /FFmpeg could not be started/);
  await source.close();
});
