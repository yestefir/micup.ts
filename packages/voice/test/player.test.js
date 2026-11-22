import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bytesPerFrame, PlaybackSkippedError, Player, scaleVolume } from '@micup.ts/voice';

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

test('rejects non-byte PCM chunks and leaves the player reusable', async () => {
  const written = [];
  const player = new Player({ async write(frame) { written.push(frame); } });
  const invalid = (async function* () { yield { length: 0 }; })();
  await assert.rejects(player.play(invalid), /PCM input must yield Uint8Array chunks/);
  assert.equal(player.playing, false);

  await player.play((async function* () { yield pcm([1, 2]); })());
  assert.equal(written.length, 1);
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

test('closes the PCM source when playback is cancelled before iteration starts', async () => {
  const player = new Player({ async write() {} });
  const controller = new AbortController();
  const reason = new Error('cancelled before playback');
  let closed = 0;
  const source = {
    [Symbol.asyncIterator]() { assert.fail('an aborted source must not be iterated'); },
    close() { closed++; },
  };
  controller.abort(reason);

  await assert.rejects(player.play(source, { signal: controller.signal }), (error) => error === reason);
  assert.equal(closed, 1);
  assert.equal(player.playing, false);
});

test('closes the PCM source when iterator creation fails', async () => {
  const player = new Player({ async write() {} });
  const reason = new Error('iterator creation failed');
  let closed = 0;
  const source = {
    [Symbol.asyncIterator]() { throw reason; },
    close() { closed++; },
  };

  await assert.rejects(player.play(source), (error) => error === reason);
  assert.equal(closed, 1);
  assert.equal(player.playing, false);
});

test('skipping a stalled input closes the source and clears queued audio before playback ends', async () => {
  let resolveClosed;
  const closed = new Promise((resolve) => { resolveClosed = resolve; });
  let resolveRead;
  let cleared = false;
  const source = {
    [Symbol.asyncIterator]() {
      return { next: () => new Promise((resolve) => { resolveRead = resolve; }) };
    },
    async close() {
      resolveRead?.({ done: true });
      resolveClosed();
    },
  };
  const player = new Player({
    async write() { assert.fail('The stalled source cannot yield samples'); },
    async clear() { cleared = true; },
  });
  const playback = player.play(source);
  assert.equal(player.playing, true);
  await Promise.resolve();
  assert.equal(player.skip(), true);
  await assert.rejects(playback, PlaybackSkippedError);
  await closed;
  assert.equal(player.playing, false);
  assert.equal(cleared, true);
});

test('skipping while the player waits for the next frame rejects with the skip error', async () => {
  const player = new Player({ async write() {}, async drain() {} });
  const source = (async function* () {
    for (let index = 0; index < 500; index++) yield Buffer.alloc(bytesPerFrame);
  })();
  const playing = player.play(source);
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(player.skip(), true);
  await assert.rejects(playing, PlaybackSkippedError);
});
