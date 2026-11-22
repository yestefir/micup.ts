import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { test } from 'node:test';
import { bytesPerFrame, openSource, VoiceConnection } from '@micup.ts/voice';

class FakeRoom extends EventEmitter {
  connected = true;
  memberCount = 2;
  frames = 0;
  closed = false;
  async write() { this.frames++; }
  async drain() {}
  async clear() {}
  async close() { this.closed = true; this.connected = false; }
}

function fixture() {
  const rooms = [];
  const calls = [];
  let counter = 0;
  const session = {
    async joinVoice(guildId, channelId, options) {
      calls.push(['join', guildId, channelId, options]);
      counter++;
      return { guild_id: guildId, channel_id: channelId, connection_id: 'connection-' + counter, endpoint: 'voice.example', token: 'token-' + counter };
    },
    async leaveVoice(guildId, connectionId) { calls.push(['leave', guildId, connectionId]); },
  };
  const connectRoom = async (grant) => {
    const room = new FakeRoom();
    room.grant = grant;
    rooms.push(room);
    return room;
  };
  return { session, rooms, calls, connectRoom };
}

const frames = (count) => (async function* () {
  for (let index = 0; index < count; index++) yield Buffer.alloc(bytesPerFrame);
})();

test('connects, plays raw PCM and reports start, finish and status events', async () => {
  const { session, rooms, calls, connectRoom } = fixture();
  const events = [];
  const connection = await VoiceConnection.connect(session, '10', '20', { connectRoom, selfDeaf: true, volume: 0.5 });
  connection.on('start', () => events.push('start'));
  connection.on('finish', (info) => events.push('finish:' + info.stopped));
  assert.equal(connection.status, 'ready');
  assert.equal(connection.guildId, '10');
  assert.equal(connection.channelId, '20');
  assert.equal(connection.connectionId, 'connection-1');
  assert.equal(connection.volume, 0.5);
  assert.equal(connection.memberCount, 2);
  assert.deepEqual(calls[0], ['join', '10', '20', { selfMute: undefined, selfDeaf: true, signal: undefined }]);

  await connection.play(frames(3), { raw: true, volume: 1 });
  assert.equal(rooms[0].frames, 3);
  assert.equal(connection.volume, 1);
  assert.equal(connection.playing, false);
  assert.deepEqual(events, ['start', 'finish:false']);

  await connection.disconnect();
  await connection.disconnect();
  assert.equal(connection.status, 'disconnected');
  assert.equal(connection.destroyed, true);
  assert.equal(rooms[0].closed, true);
  assert.equal(calls.filter(([kind]) => kind === 'leave').length, 1);
  await assert.rejects(connection.play(frames(1), { raw: true }), /not ready/);
});

test('stop ends the current track and starting another track replaces it', async () => {
  const { session, connectRoom } = fixture();
  const connection = await VoiceConnection.connect(session, '10', '20', { connectRoom });
  const finished = [];
  connection.on('finish', (info) => finished.push(info.stopped));

  const first = connection.play(frames(500), { raw: true });
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(connection.playing, true);
  assert.equal(connection.pause(), true);
  assert.equal(connection.paused, true);
  assert.equal(connection.resume(), true);
  assert.equal(connection.stop(), true);
  await first;
  assert.deepEqual(finished, [true]);

  const second = connection.play(frames(500), { raw: true });
  await new Promise((resolve) => setTimeout(resolve, 40));
  const third = connection.play(frames(2), { raw: true });
  await Promise.all([second, third]);
  assert.deepEqual(finished, [true, true, false]);
  await connection.disconnect();
});

test('forwards room members and rejects unsupported raw input', async () => {
  const { session, rooms, connectRoom } = fixture();
  const connection = await VoiceConnection.connect(session, '10', '20', { connectRoom });
  const seen = [];
  connection.on('memberJoin', (identity) => seen.push('join:' + identity));
  connection.on('memberLeave', (identity) => seen.push('leave:' + identity));
  rooms[0].emit('memberJoin', 'ada');
  rooms[0].emit('memberLeave', 'ada');
  assert.deepEqual(seen, ['join:ada', 'leave:ada']);
  await assert.rejects(connection.play('file.mp3', { raw: true }), TypeError);
  await connection.disconnect();
});

test('regrant moves to a new room, stops playback and keeps the connection usable', async () => {
  const { session, rooms, calls, connectRoom } = fixture();
  const connection = await VoiceConnection.connect(session, '10', '20', { connectRoom, volume: 0.7 });
  const statuses = [];
  const finished = [];
  connection.on('status', (status) => statuses.push(status));
  connection.on('finish', (info) => finished.push(info.stopped));

  const playing = connection.play(frames(500), { raw: true });
  await new Promise((resolve) => setTimeout(resolve, 40));
  await connection.regrant({ guild_id: '10', channel_id: '30', connection_id: 'moved', endpoint: 'voice.example', token: 'next' });
  await playing;

  assert.deepEqual(statuses, ['reconnecting', 'ready']);
  assert.deepEqual(finished, [true]);
  assert.equal(connection.channelId, '30');
  assert.equal(connection.connectionId, 'moved');
  assert.equal(connection.volume, 0.7);
  assert.equal(rooms[0].closed, true);
  assert.equal(rooms.length, 2);
  assert.equal(rooms[1].grant.token, 'next');

  await connection.play(frames(2), { raw: true });
  assert.equal(rooms[1].frames, 2);
  await connection.disconnect();
  assert.deepEqual(calls.at(-1), ['leave', '10', 'moved']);
});

test('an unexpected room disconnect closes the connection and leaves the channel', async () => {
  const { session, rooms, calls, connectRoom } = fixture();
  const connection = await VoiceConnection.connect(session, '10', '20', { connectRoom });
  const reasons = [];
  connection.on('disconnect', (reason) => reasons.push(reason?.message));
  rooms[0].emit('disconnected', new Error('LiveKit room disconnected'));
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(connection.status, 'disconnected');
  assert.deepEqual(reasons, ['LiveKit room disconnected']);
  assert.deepEqual(calls.at(-1), ['leave', '10', 'connection-1']);
});

test('emits an error event and rejects when the audio source fails', async () => {
  const { session, connectRoom } = fixture();
  const connection = await VoiceConnection.connect(session, '10', '20', { connectRoom });
  const errors = [];
  connection.on('error', (error) => errors.push(error.message));
  const broken = (async function* () { yield Buffer.alloc(bytesPerFrame); throw new Error('source failed'); })();
  await assert.rejects(connection.play(broken, { raw: true }), /source failed/);
  assert.deepEqual(errors, ['source failed']);
  await connection.disconnect();
});

test('leaves the channel again when the LiveKit connection cannot be made', async () => {
  const { session, calls } = fixture();
  await assert.rejects(VoiceConnection.connect(session, '10', '20', { connectRoom: async () => { throw new Error('no livekit'); } }), /no livekit/);
  assert.deepEqual(calls.map(([kind]) => kind), ['join', 'leave']);
});

test('opens FFmpeg sources from streams and validates the extra arguments', async () => {
  assert.throws(() => openSource(42), TypeError);
  assert.throws(() => openSource('file.mp3', { ffmpegArgs: ['-af', 3] }), TypeError);
  assert.throws(() => openSource('file.mp3', { ffmpegArgs: 'bass' }), TypeError);
  const stream = Readable.from([Buffer.from('not audio')]);
  const source = openSource(stream, { ffmpeg: 'micupts-fixture-decoder-not-installed', ffmpegArgs: ['-af', 'volume=0.5'] });
  await assert.rejects(async () => { for await (const chunk of source) void chunk; }, /FFmpeg could not be started/);
  await source.close();
  assert.equal(stream.destroyed, true);
});

test('the typed emitter supports once, off and listener counts without Node types', async () => {
  const { TypedEmitter } = await import('@micup.ts/voice');
  const emitter = new TypedEmitter();
  const seen = [];
  const listener = (value) => seen.push('on:' + value);
  emitter.on('tick', listener);
  emitter.once('tick', (value) => seen.push('once:' + value));
  assert.equal(emitter.listenerCount('tick'), 2);
  assert.equal(emitter.emit('tick', 1), true);
  assert.equal(emitter.emit('tick', 2), true);
  assert.deepEqual(seen, ['on:1', 'once:1', 'on:2']);
  emitter.off('tick', listener);
  assert.equal(emitter.emit('tick', 3), false);
  assert.equal(emitter.listenerCount('tick'), 0);
  emitter.on('a', () => {});
  emitter.removeAllListeners();
  assert.equal(emitter.listenerCount('a'), 0);
});

test('the typed emitter contains sync and async listener failures', async () => {
  const { TypedEmitter } = await import('@micup.ts/voice');
  const emitter = new TypedEmitter();
  const seen = [];
  emitter.on('error', (error) => seen.push(error.message));
  emitter.on('tick', () => { throw new Error('sync failure'); });
  emitter.on('tick', async () => { throw new Error('async failure'); });
  emitter.on('tick', (value) => seen.push('tick:' + value));

  assert.doesNotThrow(() => emitter.emit('tick', 1));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(seen, ['sync failure', 'tick:1', 'async failure']);

  const withoutErrorListener = new TypedEmitter();
  withoutErrorListener.on('tick', () => { throw new Error('contained failure'); });
  assert.doesNotThrow(() => withoutErrorListener.emit('tick'));
});
