import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bytesPerFrame, PlaybackSkippedError, Player, scaleVolume } from '@micupts/voice';

function pcm(samples) {
  const bytes = Buffer.alloc(samples.length * 2);
  samples.forEach((value, index) => bytes.writeInt16LE(value, index * 2));
  return bytes;
}

test('scales signed PCM without changing the input frame', () => {
  const frame = new Int16Array([-22000, 22000, -501, 501]);
  assert.deepEqual([...scaleVolume(frame, 2)], [-32768, 32767, -1002, 1002]);
  assert.deepEqual([...scaleVolume(frame, 0)], [0, 0, 0, 0]);
  assert.deepEqual([...frame], [-22000, 22000, -501, 501]);
});

test('plays full and short frames split across input chunks', async () => {
  const written = [];
  let drained = false;
  const player = new Player({
    async write(frame) { written.push(frame); },
    async drain() { drained = true; },
  });
  const data = Buffer.concat([Buffer.alloc(bytesPerFrame), pcm([120, -120])]);
  const source = async function* () {
    yield data.subarray(0, 3);
    yield data.subarray(3, bytesPerFrame + 1);
    yield data.subarray(bytesPerFrame + 1);
  };
  player.setVolume(0.5);
  await player.play(source());
  assert.equal(written[0].length, bytesPerFrame / 2);
  assert.deepEqual([...written[1]], [60, -60]);
  assert.equal(drained, true);
});

test('skip wakes a paused player and leaves it available for reuse', async () => {
  const written = [];
  const player = new Player({ async write(frame) { written.push(frame); } });
  const source = async function* () { yield pcm([1, 2]); };

  const playback = player.play(source());
  assert.equal(player.pause(), true);
  await assert.rejects(player.play(source()), /busy/);
  assert.equal(player.skip(), true);
  await assert.rejects(playback, PlaybackSkippedError);
  assert.equal(written.length, 0);
  await player.play(source());
  assert.equal(written.length, 1);
});
