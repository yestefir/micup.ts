import assert from 'node:assert/strict';
import { test } from 'node:test';
import { channels, sampleRate, samplesPerFrame } from '@micup.ts/voice';
import { LiveKitVoiceTrack } from '../dist/track.js';

function fixture(publishTrack) {
  const state = { sources: [], tracks: [], published: [], unpublished: [], frames: [], playouts: 0, clears: 0 };
  class AudioSource {
    constructor(rate, channelCount, queueSize) {
      this.options = [rate, channelCount, queueSize];
      state.sources.push(this);
    }
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
  const sdk = {
    AudioFrame,
    AudioSource,
    LocalAudioTrack: {
      createAudioTrack(name, source) {
        const track = {
          name,
          source,
          sid: undefined,
          closed: false,
          async close() { this.closed = true; },
        };
        state.tracks.push(track);
        return track;
      },
    },
    TrackPublishOptions,
    TrackSource: { SOURCE_MICROPHONE: 'microphone' },
  };
  const participant = {
    publishTrack(track, options) {
      state.published.push({ track, options });
      const attempt = publishTrack ? publishTrack(track, options) : undefined;
      return Promise.resolve(attempt).then((value) => {
        track.sid = 'track-1';
        return value;
      });
    },
    async unpublishTrack(sid, stopOnUnpublish) { state.unpublished.push([sid, stopOnUnpublish]); },
  };
  return { sdk, participant, state };
}

test('cleans up a LiveKit track when publishing throws synchronously', async () => {
  const failure = new Error('publish failed');
  const { sdk, participant, state } = fixture(() => { throw failure; });
  const closed = [];
  await assert.rejects(
    LiveKitVoiceTrack.publish(sdk, participant, new AbortController().signal, (track) => closed.push(track)),
    (error) => error === failure,
  );
  assert.equal(state.published.length, 1);
  assert.equal(state.tracks[0].closed, true);
  assert.deepEqual(state.unpublished, []);
  assert.equal(closed.length, 1);
});

test('publishes frames, drains, clears and closes a LiveKit track', async () => {
  const { sdk, participant, state } = fixture();
  const closed = [];
  const roomSignal = new AbortController().signal;
  const track = await LiveKitVoiceTrack.publish(sdk, participant, roomSignal, (value) => closed.push(value), {
    trackName: 'fixture', bitrate: 64_000,
  });
  assert.deepEqual(state.sources[0].options, [sampleRate, channels, 100]);
  assert.equal(state.published[0].options.audioEncoding.maxBitrate, 64_000n);
  assert.equal(state.published[0].options.dtx, false);
  await track.write(new Int16Array(samplesPerFrame));
  assert.equal(state.frames.length, 1);
  assert.equal(state.frames[0].frameSamples, samplesPerFrame / channels);
  await track.drain();
  assert.equal(state.playouts, 1);
  await track.clear();
  assert.equal(state.clears, 2);
  const closing = track.close();
  assert.equal(track.close(), closing);
  await closing;
  assert.equal(track.closed, true);
  assert.deepEqual(state.unpublished, [['track-1', false]]);
  assert.equal(state.tracks[0].closed, true);
  assert.deepEqual(closed, [track]);
  await assert.rejects(track.write(new Int16Array(channels)), /aborted|closed/i);
});
