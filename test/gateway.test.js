import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';
import { WebSocketServer } from 'ws';
import { EventMux, GatewayCloseError, GatewayOpcode as op, GatewaySession, ShardManager, shardForGuild } from 'micup.ts';

async function createGateway(t) {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await once(server, 'listening');
  t.after(async () => {
    for (const socket of server.clients) socket.terminate();
    await new Promise((resolve) => server.close(resolve));
  });
  return { server, endpoint: 'ws://127.0.0.1:' + server.address().port + '/gateway' };
}

function send(socket, op, d, t, s) {
  socket.send(JSON.stringify({ op, d, t, s }));
}

test('identifies a shard and resumes from the last successfully processed event', { timeout: 5000 }, async (t) => {
  const { server, endpoint } = await createGateway(t);
  const controller = new AbortController();
  t.after(() => controller.abort());
  const auth = [];
  const received = [];
  const ready = [];
  let connections = 0;
  let attempts = 0;
  const badSignals = [];
  const mux = new EventMux();
  mux.on('MESSAGE_CREATE', async (message, event, signal) => {
    assert.equal(event.shardId, 1);
    received.push(message.id);
    if (++attempts === 1) throw new Error('Retry this dispatch');
    assert.equal(signal.aborted, false);
  });
  mux.on('FUTURE_EVENT', (payload) => received.push(payload.id));
  server.on('connection', (socket, request) => {
    const connection = ++connections;
    assert.equal(request.url, '/gateway?v=1&encoding=json');
    send(socket, op.Hello, { heartbeat_interval: 100 });
    socket.on('message', (raw) => {
      const packet = JSON.parse(raw);
      if (packet.op === op.Heartbeat) {
        send(socket, op.HeartbeatAck);
      } else if (connection === 1) {
        auth.push(packet);
        send(socket, op.Dispatch, { session_id: 'alpha' }, 'READY', 3);
        send(socket, op.Dispatch, { id: '99' }, 'MESSAGE_CREATE', 4);
      } else {
        auth.push(packet);
        send(socket, op.Dispatch, {}, 'RESUMED');
        send(socket, op.Dispatch, { id: '99' }, 'MESSAGE_CREATE', 4);
        send(socket, op.Dispatch, { id: '100' }, 'FUTURE_EVENT', 5);
      }
    });
  });

  const session = new GatewaySession({ endpoint, token: 'fixture', shardId: 1, shardCount: 3 }, {
    ignoredEvents: ['TYPING_START'],
    minBackoffMs: 5,
    handler: async (event, signal) => {
      try {
        await mux.handle(event, signal);
      } catch (error) {
        badSignals.push(signal);
        throw error;
      }
      if (event.name === 'FUTURE_EVENT') controller.abort();
    },
    onReady: (resumed) => ready.push(resumed),
  });
  await session.run({ signal: controller.signal });

  assert.equal(connections, 2);
  assert.equal(auth[0].op, op.Identify);
  assert.deepEqual(auth[0].d.shard, [1, 3]);
  assert.deepEqual(auth[0].d.ignored_events, ['TYPING_START']);
  assert.deepEqual(auth[1], { op: op.Resume, d: { token: 'fixture', session_id: 'alpha', seq: 3 } });
  assert.deepEqual(ready, [false, true]);
  assert.deepEqual(received, ['99', '99', '100']);
  assert.equal(badSignals[0].aborted, true);
  assert.equal(session.ready, false);
});

test('reidentifies on the same socket, heartbeats with processed sequence, and stops on a fatal close', { timeout: 5000 }, async (t) => {
  const { server, endpoint } = await createGateway(t);
  const controller = new AbortController();
  t.after(() => controller.abort());
  const identifies = [];
  const invalidated = [];
  const received = [];
  let sequence;
  server.on('connection', (socket) => {
    send(socket, op.Hello, { heartbeat_interval: 100 });
    socket.on('message', (raw) => {
      const packet = JSON.parse(raw);
      if (packet.op === op.Identify) {
        identifies.push(packet);
        if (identifies.length === 1) {
          send(socket, op.Dispatch, { session_id: 'before' }, 'READY', 1);
          send(socket, op.InvalidSession, false);
        } else {
          send(socket, op.Dispatch, { session_id: 'after' }, 'READY', 7);
        }
      } else if (packet.op === op.Heartbeat && identifies.length === 2) {
        sequence = packet.d;
        send(socket, op.HeartbeatAck);
        socket.close(4004, 'fixture rejection');
      }
    });
  });
  const session = new GatewaySession({ endpoint, token: 'fixture' }, {
    beforeIdentify: async () => { invalidated.push(session.sessionId); },
    handler: (event) => received.push(event.data.session_id),
  });
  await assert.rejects(session.run({ signal: controller.signal }), (error) => {
    assert.ok(error instanceof GatewayCloseError);
    assert.equal(error.code, 4004);
    assert.equal(error.fatal, true);
    return true;
  });
  assert.equal(identifies.length, 2);
  assert.deepEqual(invalidated, [undefined, undefined]);
  assert.deepEqual(received, ['before', 'after']);
  assert.equal(sequence, 7);
});

test('routes snowflakes and shuts down all local shards on a fatal close', { timeout: 5000 }, async (t) => {
  const { server, endpoint } = await createGateway(t);
  const controller = new AbortController();
  t.after(() => controller.abort());
  const identified = new Map();
  const closed = new Set();
  server.on('connection', (socket) => {
    send(socket, op.Hello, { heartbeat_interval: 100 });
    socket.on('message', (raw) => {
      const packet = JSON.parse(raw);
      if (packet.op === op.Heartbeat) {
        send(socket, op.HeartbeatAck);
        return;
      }
      assert.equal(packet.op, op.Identify);
      const [id, count] = packet.d.shard;
      assert.equal(count, 3);
      identified.set(id, socket);
      socket.on('close', () => closed.add(id));
      send(socket, op.Dispatch, { session_id: String(id) }, 'READY', 1);
      if (identified.size === 2) socket.close(4011, 'fixture fatal close');
    });
  });
  const manager = new ShardManager({ endpoint, token: 'fixture' }, {
    shardCount: 3,
    shardIds: [2, 0],
    identifyIntervalMs: 10,
    session: { handler: () => {} },
  });

  assert.equal(shardForGuild('18446744073709551615', 3), 0);
  assert.equal(manager.forGuild(String(2n << 22n)).shardId, 2);
  assert.throws(() => manager.forGuild(String(1n << 22n)), /does not own/);
  await assert.rejects(manager.run({ signal: controller.signal }), (error) =>
    error.cause instanceof GatewayCloseError && error.cause.code === 4011);
  for (const socket of identified.values()) {
    if (socket.readyState !== 3) await once(socket, 'close');
  }
  assert.deepEqual([...closed].sort(), [0, 2]);
  assert.equal(manager.ready, false);
});
