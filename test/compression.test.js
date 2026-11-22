import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';
import * as zlib from 'node:zlib';
import { WebSocketServer } from 'ws';
import { GatewayCompression } from '../dist/gateway/compression.js';
import { GatewayOpcode, GatewaySession } from 'micup.ts';

test('keeps the connection usable when a compressed send is cancelled before encoding', {
  skip: typeof zlib.createZstdCompress !== 'function' || typeof zlib.createZstdDecompress !== 'function',
}, async () => {
  const lifetime = new AbortController();
  const caller = new AbortController();
  const reason = new Error('send cancelled before encoding');
  caller.abort(reason);
  let writes = 0;
  let reported;
  const compression = new GatewayCompression(lifetime.signal, () => {}, (error) => { reported = error; }, () => {});

  try {
    await assert.rejects(compression.send('{}', () => { writes++; }, caller.signal), (error) => error === reason);
    assert.equal(writes, 0);
    assert.equal(reported, undefined);
    assert.equal(lifetime.signal.aborted, false);
  } finally {
    compression.destroy();
  }
});

test('cancels a compressed write when its caller aborts during flush', {
  skip: typeof zlib.createZstdCompress !== 'function' || typeof zlib.createZstdDecompress !== 'function',
}, async () => {
  const lifetime = new AbortController();
  const reason = new Error('send cancelled');
  let writes = 0;
  let aborted = false;
  let reported;
  const caller = {
    get aborted() { return aborted; },
    get reason() { return reason; },
    throwIfAborted() { if (aborted) throw reason; },
    addEventListener(_type, listener) {
      queueMicrotask(() => {
        aborted = true;
        listener();
      });
    },
    removeEventListener() {},
  };
  const compression = new GatewayCompression(lifetime.signal, () => {}, (error) => { reported = error; }, () => {});

  try {
    await assert.rejects(compression.send('{}', () => { writes++; }, caller), (error) => error === reason);
    assert.equal(writes, 0);
    assert.equal(reported?.cause, reason);
  } finally {
    compression.destroy();
  }
});

test('uses one Zstandard stream in each direction across binary WebSocket messages', {
  skip: typeof zlib.createZstdCompress !== 'function',
  timeout: 5000,
}, async (t) => {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await once(server, 'listening');
  const stop = new AbortController();
  t.after(async () => {
    stop.abort();
    for (const socket of server.clients) socket.terminate();
    await new Promise((resolve) => server.close(resolve));
  });

  const writes = [];
  server.once('connection', async (socket, request) => {
    const query = new URL(request.url, 'http://localhost').searchParams;
    assert.equal(query.get('compress'), 'zstd-stream');
    assert.equal(query.get('stream'), '1');
    const encoder = zlib.createZstdCompress();
    const decoder = zlib.createZstdDecompress();
    socket.once('close', () => { encoder.destroy(); decoder.destroy(); });
    const chunks = [];
    encoder.on('data', (chunk) => chunks.push(chunk));
    const send = async (...packets) => {
      encoder.write(packets.map((packet) => JSON.stringify(packet)).join('\n'));
      await new Promise((resolve) => encoder.flush(resolve));
      const message = Buffer.concat(chunks.splice(0));
      const cut = Math.floor(message.length / 2);
      socket.send(message.subarray(0, cut));
      socket.send(message.subarray(cut));
    };
    let inbound = '';
    socket.on('message', (data, binary) => {
      assert.equal(binary, true);
      decoder.write(data);
    });
    decoder.setEncoding('utf8');
    decoder.on('data', async (data) => {
      inbound += data;
      let packet;
      try { packet = JSON.parse(inbound); } catch { return; }
      inbound = '';
      writes.push(packet);
      if (packet.op === GatewayOpcode.Identify) {
        await send(
          { op: 0, t: 'READY', s: 1, d: { session_id: 'zstd' } },
          { op: 0, t: 'COMPRESSED', s: 2, d: { text: '{ [ "]" } ' + 'ses İstanbul '.repeat(2000) } },
        );
      } else if (packet.op === GatewayOpcode.PresenceUpdate) {
        stop.abort();
      }
    });
    await send({ op: GatewayOpcode.Hello, d: { heartbeat_interval: 1000 } });
  });

  const session = new GatewaySession({ endpoint: 'ws://127.0.0.1:' + server.address().port, token: 'fixture' }, {
    compress: true,
    handler: async ({ name, data }, signal) => {
      if (name === 'COMPRESSED') {
        assert.equal(data.text, '{ [ "]" } ' + 'ses İstanbul '.repeat(2000));
        await session.setStatus('idle', { signal });
      }
    },
  });
  await session.run({ signal: stop.signal });
  assert.deepEqual(writes.map(({ op }) => op), [GatewayOpcode.Identify, GatewayOpcode.PresenceUpdate]);
  assert.equal(writes[1].d.status, 'idle');
});
