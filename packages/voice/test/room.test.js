import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import { VoiceRoom } from '../dist/room.js';

function fixture() {
  const state = { sources: [], tracks: [], published: [], unpublished: [], connects: [], frames: [], playouts: 0, clears: 0, disconnected: 0 };
  class AudioSource {
    constructor() { state.sources.push(this); }
    async captureFrame(frame) { state.frames.push(frame); }
    async waitForPlayout() { state.playouts++; }
    clearQueue() { state.clears++; }
  }
  class AudioFrame {
    constructor(data, rate, channelCount, frameSamples) {
      Object.assign(this, { data, rate, channelCount, frameSamples });
    }
  }
  class TrackPublishOptions {
    constructor(options) { Object.assign(this, options); }
  }
  const participant = {
    async publishTrack(track) {
      track.sid = 'track-' + (state.published.length + 1);
      state.published.push(track);
    },
    async unpublishTrack(sid, stopOnUnpublish) { state.unpublished.push([sid, stopOnUnpublish]); },
  };
  class FakeRoom extends EventEmitter {
    isConnected = true;
    remoteParticipants = new Map([['member-1', {}]]);
    localParticipant = participant;
    async connect(...args) { state.connects.push(args); }
    async disconnect() {
      state.disconnected++;
      this.isConnected = false;
    }
  }
  const sdk = {
    AudioFrame,
    AudioSource,
    LocalAudioTrack: {
      createAudioTrack(name, source) {
        const track = { name, source, sid: undefined, closed: false, async close() { this.closed = true; } };
        state.tracks.push(track);
        return track;
      },
    },
    RoomEvent: {
      Disconnected: 'disconnected',
      ParticipantConnected: 'participantConnected',
      ParticipantDisconnected: 'participantDisconnected',
    },
    Room: FakeRoom,
    TrackPublishOptions,
    TrackSource: { SOURCE_MICROPHONE: 'microphone' },
  };
  const room = new FakeRoom();
  return { sdk, room, state };
}

test('forwards LiveKit membership events and closes published tracks once', async () => {
  const { sdk, room, state } = fixture();
  const voice = new VoiceRoom(sdk, room, {});
  const members = [];
  voice.on('memberJoin', (identity) => members.push('join:' + identity));
  voice.on('memberLeave', (identity) => members.push('leave:' + identity));
  assert.equal(voice.connected, true);
  assert.equal(voice.memberCount, 1);

  room.emit('participantConnected', { identity: 'member-2' });
  room.emit('participantDisconnected', { identity: 'member-1' });
  assert.deepEqual(members, ['join:member-2', 'leave:member-1']);

  const track = await voice.openTrack({ trackName: 'fixture' });
  assert.equal(state.published.length, 1);
  const closing = voice.close();
  assert.equal(voice.close(), closing);
  await closing;
  assert.equal(voice.connected, false);
  assert.equal(state.tracks[0].closed, true);
  assert.deepEqual(state.unpublished, []);
  assert.equal(state.disconnected, 1);
  assert.equal(track.closed, true);
  await assert.rejects(voice.openTrack(), /disconnected/);
});

test('emits one unexpected disconnect and closes its room', async () => {
  const { sdk, room, state } = fixture();
  const voice = new VoiceRoom(sdk, room, {});
  const reasons = [];
  voice.on('disconnected', (reason) => reasons.push(reason.message));
  room.emit('disconnected');
  room.emit('disconnected');
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(reasons, ['LiveKit room disconnected']);
  assert.equal(voice.connected, false);
  assert.equal(state.disconnected, 1);
});

test('rejects unsupported grants and already-aborted room connections', async () => {
  const grant = { endpoint: 'voice.example', token: 'fixture' };
  await assert.rejects(VoiceRoom.connect({ ...grant, p2p: true }), /unencrypted Micup voice/);
  await assert.rejects(VoiceRoom.connect({ ...grant, endpoint: 'ws://voice.example' }), /Invalid LiveKit endpoint/);
  const controller = new AbortController();
  const reason = new Error('room connection cancelled');
  controller.abort(reason);
  await assert.rejects(VoiceRoom.connect(grant, { signal: controller.signal }), (error) => error === reason);
});

test('cleans up a room when connect throws synchronously and retains the cause', async () => {
  const failure = new Error('connect failed');
  const { sdk, state } = fixture();
  class BrokenRoom extends EventEmitter {
    connect() { throw failure; }
    async disconnect() { state.disconnected++; }
  }
  await assert.rejects(
    VoiceRoom.connectWithSDK({ ...sdk, Room: BrokenRoom }, new URL('wss://voice.example'),
      { endpoint: 'voice.example', token: 'fixture' }, {}, new AbortController().signal),
    (error) => error.message === 'LiveKit audio connection failed' && error.cause === failure,
  );
  assert.equal(state.disconnected, 1);
});

test('connects to a LiveKit room without publishing the default track', async () => {
  const { sdk, state } = fixture();
  const voice = await VoiceRoom.connectWithSDK(sdk, new URL('wss://voice.example'),
    { endpoint: 'voice.example', token: 'fixture' }, { publishOnConnect: false }, new AbortController().signal);
  assert.equal(voice.connected, true);
  assert.deepEqual(state.connects, [['wss://voice.example/', 'fixture', { autoSubscribe: false, dynacast: false }]]);
  assert.equal(state.published.length, 0);
  await voice.close();
  assert.equal(state.disconnected, 1);
});

test('publishes a default track and forwards room playback operations', async () => {
  const { sdk, state } = fixture();
  const voice = await VoiceRoom.connectWithSDK(sdk, new URL('wss://voice.example'),
    { endpoint: 'voice.example', token: 'fixture' }, {}, new AbortController().signal);
  assert.equal(state.published.length, 1);
  const samples = new Int16Array(1920);
  await voice.write(samples);
  await voice.drain();
  await voice.clear();
  assert.equal(state.frames.length, 1);
  assert.equal(state.frames[0].frameSamples, 960);
  assert.equal(state.playouts, 1);
  assert.equal(state.clears, 2);
  await voice.close();
});
