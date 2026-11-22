import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';
import { WebSocketServer } from 'ws';
import { EventMux, GatewayCloseError, GatewayOpcode as op, GatewaySession, safeHandler, ShardManager, shardForGuild } from 'micup.ts';
import { MemberInventory } from '../dist/session/inventory.js';
import { SessionRequests } from '../dist/session/requests.js';

test('a cancelled slot waiter passes an available slot to the next waiter', async () => {
  const sent = [];
  const requests = new SessionRequests(async (opcode, data) => { sent.push({ opcode, data }); });
  const first = requests.members('10', { query: 'first', limit: 1 });
  const cancelled = new AbortController();
  const skipped = requests.members('11', { query: 'skipped', limit: 1, signal: cancelled.signal });
  const next = requests.members('12', { query: 'next', limit: 1 });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(sent.length, 1);

  requests.receive({
    name: 'GUILD_MEMBERS_CHUNK',
    sequence: 1,
    shardId: 0,
    data: { guild_id: '10', nonce: sent[0].data.nonce, chunk_count: 1, chunk_index: 0, members: [] },
  });
  queueMicrotask(() => cancelled.abort());

  await first;
  await assert.rejects(skipped, (error) => error === cancelled.signal.reason);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(sent.length, 2);
  requests.receive({
    name: 'GUILD_MEMBERS_CHUNK',
    sequence: 2,
    shardId: 0,
    data: { guild_id: '12', nonce: sent[1].data.nonce, chunk_count: 1, chunk_index: 0, members: [] },
  });
  assert.deepEqual(await next, []);
});

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

test('safeHandler contains synchronous and asynchronous error reporter failures', async () => {
  const event = { name: 'MESSAGE_CREATE', data: {}, sequence: 1, shardId: 0 };
  const signal = new AbortController().signal;
  const synchronous = safeHandler(() => { throw new Error('handler failure'); }, {
    onError: () => { throw new Error('reporter failure'); },
  });
  const asynchronous = safeHandler(() => { throw new Error('handler failure'); }, {
    onError: async () => { throw new Error('reporter failure'); },
  });

  await synchronous(event, signal);
  await asynchronous(event, signal);
  await new Promise((resolve) => setImmediate(resolve));
});

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

test('rejects shard IDs outside the configured shard range', () => {
  const create = (shardIds) => new ShardManager({ endpoint: 'ws://localhost', token: 'fixture' }, {
    shardCount: 3,
    shardIds,
    session: { handler: () => {} },
  });

  assert.throws(() => create([-1]), /within the shard count/);
  assert.throws(() => create([3]), /within the shard count/);
  assert.throws(() => create([1.5]), /within the shard count/);
  assert.throws(() => create([Number.MAX_SAFE_INTEGER + 1]), /within the shard count/);
  assert.throws(() => create([]), /At least one shard ID/);
  assert.deepEqual(create([2, 0]).shards.map((shard) => shard.shardId), [0, 2]);
});

test('completes a voice join while a Gateway event handler waits for the grant', { timeout: 5000 }, async (t) => {
  const { server, endpoint } = await createGateway(t);
  const controller = new AbortController();
  t.after(() => controller.abort());
  const writes = [];
  let result;
  server.on('connection', (socket) => {
    send(socket, op.Hello, { heartbeat_interval: 100 });
    socket.on('message', (raw) => {
      const packet = JSON.parse(raw);
      if (packet.op === op.Identify) {
        send(socket, op.Dispatch, { session_id: 'voice', user: { id: '202' } }, 'READY', 1);
        send(socket, op.Dispatch, {}, 'MESSAGE_CREATE', 2);
      } else if (packet.op === op.VoiceStateUpdate) {
        writes.push(packet.d);
        if (packet.d.channel_id) {
          send(socket, op.Dispatch, {
            guild_id: '888', channel_id: '555', connection_id: 'wrong', endpoint: 'voice.example', token: 'fixture',
          }, 'VOICE_SERVER_UPDATE', 3);
          send(socket, op.Dispatch, {
            guild_id: '123', channel_id: '456', connection_id: 'connection', endpoint: 'voice.example', token: 'fixture',
          }, 'VOICE_SERVER_UPDATE', 4);
        } else {
          controller.abort();
        }
      } else if (packet.op === op.Heartbeat) {
        send(socket, op.HeartbeatAck);
      }
    });
  });

  const session = new GatewaySession({ endpoint, token: 'fixture' }, {
    handler: async (event, signal) => {
      if (event.name !== 'MESSAGE_CREATE') return;
      result = await session.joinVoice('123', '456', { selfDeaf: true, signal });
      assert.equal(session.voice('123')?.connection_id, 'connection');
      await session.leaveVoice('123', 'old-connection', { signal });
      await session.leaveVoice('123', result.connection_id, { signal });
    },
  });

  await session.run({ signal: controller.signal });
  assert.equal(result.endpoint, 'voice.example');
  assert.equal(result.connection_id, 'connection');
  assert.deepEqual(writes, [
    { guild_id: '123', channel_id: '456', self_mute: false, self_deaf: true, self_video: false, self_stream: false },
    { guild_id: '123', channel_id: null, connection_id: 'connection' },
  ]);
  assert.equal(session.voice('123'), undefined);
});

test('publishes presence and correlates count replies and out-of-order member chunks', { timeout: 5000 }, async (t) => {
  const { server, endpoint } = await createGateway(t);
  const controller = new AbortController();
  t.after(() => controller.abort());
  const writes = [];
  let members;
  let counts;
  server.on('connection', (socket) => {
    send(socket, op.Hello, { heartbeat_interval: 100 });
    socket.on('message', (raw) => {
      const packet = JSON.parse(raw);
      writes.push(packet);
      if (packet.op === op.Identify) {
        send(socket, op.Dispatch, { session_id: 'requests' }, 'READY', 1);
        send(socket, op.Dispatch, {}, 'WORK', 2);
      } else if (packet.op === op.RequestGuildCounts) {
        send(socket, op.Dispatch, { nonce: 'unrelated', counts: [] }, 'GUILD_COUNTS_UPDATE', 3);
        send(socket, op.Dispatch, {
          nonce: packet.d.nonce, counts: [{ guild_id: '10', member_count: 5, online_count: 3 }],
        }, 'GUILD_COUNTS_UPDATE', 4);
      } else if (packet.op === op.RequestGuildMembers) {
        for (const index of [1, 0]) {
          send(socket, op.Dispatch, {
            guild_id: '10', nonce: packet.d.nonce,
            chunk_count: 2, chunk_index: index, members: [{ user: { id: String(index + 1) }, roles: [] }],
          }, 'GUILD_MEMBERS_CHUNK', 6 - index);
        }
      } else if (packet.op === op.Heartbeat) {
        send(socket, op.HeartbeatAck);
      }
    });
  });

  const session = new GatewaySession({ endpoint, token: 'fixture' }, {
    presence: { status: 'offline', custom_status: { text: 'Working' } },
    handler: async (event, signal) => {
      if (event.name !== 'WORK') return;
      await session.setCustomStatus(null, { signal });
      counts = await session.requestGuildCounts(['10', '10'], { signal });
      members = await session.requestGuildMembers('10', { query: 'a', limit: 2, signal });
      controller.abort();
    },
  });

  await session.run({ signal: controller.signal });
  assert.deepEqual(writes[0].d.presence, { status: 'invisible', afk: false, mobile: false, custom_status: { text: 'Working' } });
  assert.deepEqual(writes.find((entry) => entry.op === op.PresenceUpdate).d,
    { status: 'invisible', afk: false, mobile: false, custom_status: null });
  assert.deepEqual(writes.find((entry) => entry.op === op.RequestGuildCounts).d.guild_ids, ['10']);
  assert.deepEqual(counts, [{ guild_id: '10', member_count: 5, online_count: 3 }]);
  assert.deepEqual(members.map((member) => member.user.id), ['1', '2']);
});

test('merges Gateway member changes into a paginated inventory without sharing its storage', { timeout: 6000 }, async (t) => {
  const { server, endpoint } = await createGateway(t);
  const controller = new AbortController();
  t.after(() => controller.abort());
  let socket;
  let sequence = 1;
  let releasePage;
  const changes = new Promise((resolve) => { releasePage = resolve; });
  const lookups = [];

  server.on('connection', (connected) => {
    socket = connected;
    send(socket, op.Hello, { heartbeat_interval: 100 });
    socket.on('message', (data) => {
      const packet = JSON.parse(data);
      if (packet.op === op.Heartbeat) send(socket, op.HeartbeatAck);
      if (packet.op === op.Identify) {
        send(socket, op.Dispatch, {
          session_id: 'membership', guilds: [{ id: '10', members: [{ user: { id: '20' }, roles: [] }] }],
        }, 'READY', sequence++);
      }
    });
  });

  const session = new GatewaySession({
    endpoint, token: 'fixture',
    lookupMembers: async (guildId, { after, limit }) => {
      assert.equal(guildId, '10');
      assert.equal(limit, 1000);
      lookups.push(after);
      if (!after) {
        send(socket, op.Dispatch, { guild_id: '10', user: { id: '20' } }, 'GUILD_MEMBER_REMOVE', sequence++);
        send(socket, op.Dispatch, { guild_id: '10', user: { id: '21', bot: true }, roles: [] }, 'GUILD_MEMBER_ADD', sequence++);
        await changes;
        return Array.from({ length: 1000 }, (_, index) => ({ user: { id: String(100 + index) }, roles: [] }));
      }
      return [{ user: { id: '20' }, roles: [] }];
    },
  }, {
    trackMembers: true,
    handler: ({ name }) => { if (name === 'GUILD_MEMBER_ADD') releasePage(); },
  });
  const running = session.run({ signal: controller.signal });
  try {
    while (!session.memberInventories()[0]?.complete) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    const [snapshot] = session.memberInventories();
    assert.deepEqual(lookups, [undefined, '1099']);
    assert.equal(snapshot.members.has('20'), false);
    assert.equal(snapshot.members.get('21'), true);
    snapshot.members.clear();
    assert.equal(session.memberInventories()[0].members.size, 1001);
  } finally {
    controller.abort();
    await running;
  }
});

test('reports member inventory lookup failures without stopping its worker', { timeout: 5000 }, async () => {
  const controller = new AbortController();
  let reported;
  const inventory = new MemberInventory(async () => { throw new Error('temporary lookup failure'); }, (guildId, error) => {
    reported = { guildId, error };
    controller.abort();
  });
  inventory.observe({ name: 'READY', data: { guilds: [{ id: '10' }] } });

  await inventory.run(() => true, controller.signal);

  assert.equal(reported.guildId, '10');
  assert.match(reported.error.message, /temporary lookup failure/);
  assert.equal(inventory.snapshots()[0].complete, false);
});

test('sends Lazy Request subscriptions and exposes a one-connection runner', { timeout: 5000 }, async (t) => {
  const { server, endpoint } = await createGateway(t);
  const control = new AbortController();
  t.after(() => control.abort());
  let received;
  server.once('connection', (socket) => {
    send(socket, op.Hello, { heartbeat_interval: 1000 });
    socket.on('message', (raw) => {
      const packet = JSON.parse(raw);
      if (packet.op === op.Identify) send(socket, op.Dispatch, { session_id: 'lazy' }, 'READY', 1);
      if (packet.op === op.LazyRequest) {
        received = packet.d;
        socket.close(4000, 'fixture ended');
      }
    });
  });
  const body = { '101': { active: true, member_list_channels: { '102': [[0, 99]] }, thread_member_lists: [] } };
  const session = new GatewaySession({ endpoint, token: 'fixture' }, {
    handler: () => {},
    onReady: () => {
      void session.subscribe(body, { signal: control.signal }).catch(() => control.abort());
    },
  });
  assert.throws(() => session.subscribe({ '101': { member_list_channels: { '102': [[0, 100]] } } }), /ranges/);
  await assert.rejects(session.runOnce({ signal: control.signal }), (error) => error instanceof GatewayCloseError && error.code === 4000);
  assert.deepEqual(received, { subscriptions: body });
});

test('logs readiness, invalidation and disconnects with the shard', { timeout: 5000 }, async (t) => {
  const { server, endpoint } = await createGateway(t);
  const controller = new AbortController();
  t.after(() => controller.abort());
  const lines = [];
  let identifies = 0;
  server.on('connection', (socket) => {
    send(socket, op.Hello, { heartbeat_interval: 100 });
    socket.on('message', (raw) => {
      const packet = JSON.parse(raw);
      if (packet.op === op.Identify) {
        identifies++;
        send(socket, op.Dispatch, { session_id: 's' + identifies }, 'READY', identifies);
        if (identifies === 1) send(socket, op.InvalidSession, false);
      } else if (packet.op === op.Heartbeat && identifies === 2) {
        send(socket, op.HeartbeatAck);
        socket.close(4004, 'fixture rejection');
      }
    });
  });
  const logger = {
    info: (message, fields) => lines.push(['info', message, fields]),
    warn: (message, fields) => lines.push(['warn', message, fields]),
  };
  const session = new GatewaySession({ endpoint, token: 'fixture' }, { handler: () => {}, logger });
  await assert.rejects(session.run({ signal: controller.signal }), GatewayCloseError);
  assert.deepEqual(lines.map(([level, message]) => level + ':' + message), [
    'info:gateway session invalidated', 'info:gateway ready', 'warn:gateway disconnected',
  ]);
  assert.deepEqual(lines.at(-1)[2], { shard: 0, error: 'Micup Gateway closed with code 4004: fixture rejection', code: 4004, reconnecting: false });

  const warned = [];
  const quiet = new GatewaySession({ endpoint, token: 'fixture' }, { handler: () => {}, logger: { warn: (message) => { warned.push(message); throw new Error('logger failure'); } } });
  identifies = 0;
  await assert.rejects(quiet.run({ signal: controller.signal }), GatewayCloseError);
  assert.ok(warned.includes('gateway ready'));
});
