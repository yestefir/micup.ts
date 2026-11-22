import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';
import { WebSocketServer } from 'ws';
import { GatewayOpcode as op, GatewayRequestError, GatewaySession, MicupAPIError, MicupClient, MicupErrorCode } from 'micup.ts';

const origin = 'https://micup.example';

async function connect(t, handler, options = {}) {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    if (String(url) === origin + '/.well-known/fluxer') return Response.json({ endpoints: { api_public: origin + '/api' } });
    if (String(url) === origin + '/api/v1/users/@me' && init.method === 'GET') return Response.json({ id: '77', bot: true });
    const target = new URL(url);
    const call = { at: performance.now(), method: init.method, path: target.pathname.replace('/api/v1', ''), auth: init.headers.get('Authorization') };
    calls.push(call);
    return handler(call, init, calls);
  });
  return { bot: await MicupClient.connect({ origin, token: 'fixture', ...options }), calls };
}

const ok = () => Response.json({ id: '1' });
const failure = (status, code, extra = {}) => Response.json({ code, message: code, ...extra }, { status, headers: extra.retry_after === undefined ? {} : { 'retry-after': String(Math.ceil(extra.retry_after)) } });

test('paces authenticated requests below the global bucket of 50 per second', { timeout: 20000 }, async (t) => {
  const { bot, calls } = await connect(t, ok);
  await Promise.all(Array.from({ length: 120 }, () => bot.channels.get('20')));
  assert.equal(calls.length, 120);
  const times = calls.map((call) => call.at);
  const first = times[0];
  const early = times.filter((at) => at < first + 900).length;
  assert.ok(early <= 45, early + ' requests were sent in the first 900 ms');
  assert.ok(times.at(-1) - first >= 1500, 'finished too fast: ' + (times.at(-1) - first));
});

test('does not count webhook token and interaction callback requests against the global bucket', { timeout: 10000 }, async (t) => {
  const { bot, calls } = await connect(t, ok);
  const started = performance.now();
  await Promise.all([
    ...Array.from({ length: 80 }, () => bot.webhooks.execute('5', 'token', 'hello')),
    ...Array.from({ length: 60 }, (_, index) => bot.interactions.respond({ id: String(900 + index), token: 'tok' }, 'pong')),
  ]);
  assert.equal(calls.length, 140);
  assert.ok(performance.now() - started < 800, 'took ' + (performance.now() - started));
});

test('waits for retry_after from the body, not the rounded header, and retries the request', { timeout: 10000 }, async (t) => {
  let first = true;
  const { bot, calls } = await connect(t, () => {
    if (first) {
      first = false;
      return Response.json({ code: 'RATE_LIMITED', message: 'slow down', global: false, retry_after: 0.15 }, { status: 429, headers: { 'retry-after': '5' } });
    }
    return ok();
  });
  const started = performance.now();
  await bot.channels.get('20');
  const elapsed = performance.now() - started;
  assert.equal(calls.length, 2);
  assert.ok(elapsed >= 120 && elapsed < 1500, 'waited ' + elapsed);
});

test('a global 429 pauses every route of the token', { timeout: 10000 }, async (t) => {
  let limited = false;
  const { bot, calls } = await connect(t, (call) => {
    if (!limited && call.path === '/channels/20') {
      limited = true;
      return Response.json({ code: 'RATE_LIMITED', message: 'global', global: true, retry_after: 0.3 }, { status: 429, headers: { 'x-ratelimit-global': 'true', 'retry-after': '1' } });
    }
    return ok();
  });
  const first = bot.channels.get('20');
  await new Promise((resolve) => setTimeout(resolve, 30));
  const started = performance.now();
  await bot.guilds.get('10');
  await first;
  assert.ok(performance.now() - started >= 200, 'the other route did not wait: ' + (performance.now() - started));
  assert.equal(calls.filter((call) => call.path === '/channels/20').length, 2);
});

test('slows down on X-RateLimit-Remaining 0 before the bucket is denied', { timeout: 10000 }, async (t) => {
  const { bot, calls } = await connect(t, (call, init, all) => all.length === 1
    ? Response.json({ id: '1' }, { headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset-after': '0.25' } })
    : ok());
  await bot.channels.get('20');
  const started = performance.now();
  await bot.channels.get('20');
  assert.ok(performance.now() - started >= 200, 'did not wait for the reset: ' + (performance.now() - started));
  assert.equal(calls.length, 2);
});

test('stops sending the same rejected request after the limit', { timeout: 10000 }, async (t) => {
  const { bot, calls } = await connect(t, (call) => call.path === '/channels/20' ? failure(404, 'UNKNOWN_CHANNEL') : ok(), { rejectedRequestLimit: 3 });
  for (let index = 0; index < 3; index++) await assert.rejects(bot.channels.get('20'), (error) => error.status === 404);
  assert.equal(calls.length, 3);
  await assert.rejects(bot.channels.get('20'), (error) => error instanceof MicupAPIError && error.status === 404 && error.code === 'UNKNOWN_CHANNEL');
  await assert.rejects(bot.channels.get('20'), MicupAPIError);
  assert.equal(calls.length, 3, 'the blocked request must not reach the server');
  await bot.channels.get('21');
  await bot.channels.get('22');
  assert.equal(calls.length, 5, 'other paths are not affected');
});

test('rejections below the limit are forgotten after a success', { timeout: 10000 }, async (t) => {
  let missing = true;
  const { bot, calls } = await connect(t, (call) => call.path === '/channels/20' && missing ? failure(403, 'MISSING_PERMISSIONS') : ok(), { rejectedRequestLimit: 3 });
  await assert.rejects(bot.channels.get('20'));
  await assert.rejects(bot.channels.get('20'));
  missing = false;
  await bot.channels.get('20');
  missing = true;
  await assert.rejects(bot.channels.get('20'));
  await assert.rejects(bot.channels.get('20'));
  assert.equal(calls.length, 5);
  await assert.rejects(bot.channels.get('20'));
  assert.equal(calls.length, 6);
  await assert.rejects(bot.channels.get('20'));
  assert.equal(calls.length, 6, 'the third rejection since the success blocks the route');
});

test('three rejected tokens in a row stop all authenticated requests', { timeout: 10000 }, async (t) => {
  const { bot, calls } = await connect(t, () => failure(401, 'UNAUTHORIZED'));
  for (const id of ['1', '2', '3']) await assert.rejects(bot.channels.get(id), (error) => error.status === 401);
  assert.equal(calls.length, 3);
  await assert.rejects(bot.guilds.get('10'), (error) => error.status === 401);
  assert.equal(calls.length, 3, 'no further request is sent with a token the server rejects');
});

test('the rejected request guard can be turned off', { timeout: 10000 }, async (t) => {
  const { bot, calls } = await connect(t, () => failure(404, 'UNKNOWN_CHANNEL'), { rejectedRequestLimit: 0 });
  for (let index = 0; index < 8; index++) await assert.rejects(bot.channels.get('20'));
  assert.equal(calls.length, 8);
});

test('a new DM quota error that clears within 30 seconds is waited out and retried', { timeout: 10000 }, async (t) => {
  let refused = true;
  const { bot, calls } = await connect(t, (call) => {
    if (call.path === '/users/@me/channels' && refused) {
      refused = false;
      return failure(429, MicupErrorCode.NewDMRateLimited, { retry_after: 0.1 });
    }
    return call.path === '/users/@me/channels' ? Response.json({ id: '33', type: 1 }) : Response.json({ id: '44', channel_id: '33', content: 'hi' });
  });
  const started = performance.now();
  const message = await bot.sendDM('5', 'hi');
  assert.equal(message.id, '44');
  assert.ok(performance.now() - started >= 80);
  assert.deepEqual(calls.map((call) => call.method + ' ' + call.path), ['POST /users/@me/channels', 'POST /users/@me/channels', 'POST /channels/33/messages']);
});

test('a DM quota that needs more than 30 seconds is returned at once and no message is sent', { timeout: 10000 }, async (t) => {
  const { bot, calls } = await connect(t, () => failure(429, MicupErrorCode.NewDMRateLimited, { retry_after: 45 }));
  const started = performance.now();
  await assert.rejects(bot.sendDM('5', 'hi'), (error) => {
    assert.ok(error instanceof MicupAPIError);
    assert.equal(error.code, 'NEW_DM_RATE_LIMITED');
    assert.equal(error.rateLimited, true);
    assert.equal(error.retryAfterMs, 45_000);
    return true;
  });
  assert.ok(performance.now() - started < 500);
  assert.deepEqual(calls.map((call) => call.path), ['/users/@me/channels']);
});

test('a DM spam block is never retried', { timeout: 10000 }, async (t) => {
  const { bot, calls } = await connect(t, (call) => call.path === '/users/@me/channels'
    ? Response.json({ id: '33', type: 1 })
    : failure(400, MicupErrorCode.SpamBlocked));
  await assert.rejects(bot.sendDM('5', 'same text for everyone'), (error) => error.code === 'SPAM_BLOCKED' && error.status === 400);
  assert.deepEqual(calls.map((call) => call.method + ' ' + call.path), ['POST /users/@me/channels', 'POST /channels/33/messages']);
});

async function gateway(t) {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await once(server, 'listening');
  t.after(async () => {
    for (const socket of server.clients) socket.terminate();
    await new Promise((resolve) => server.close(resolve));
  });
  return { server, endpoint: 'ws://127.0.0.1:' + server.address().port + '/gateway' };
}

const reply = (socket, opcode, data, name, sequence) => socket.send(JSON.stringify({ op: opcode, d: data, t: name, s: sequence }));

test('asks for a full member list at most once every 30 seconds per guild without sending the extra request', { timeout: 8000 }, async (t) => {
  const { server, endpoint } = await gateway(t);
  const controller = new AbortController();
  t.after(() => controller.abort());
  const requests = [];
  server.on('connection', (socket) => {
    reply(socket, op.Hello, { heartbeat_interval: 100 });
    socket.on('message', (raw) => {
      const packet = JSON.parse(raw);
      if (packet.op === op.Identify) {
        reply(socket, op.Dispatch, { session_id: 's' }, 'READY', 1);
        reply(socket, op.Dispatch, {}, 'WORK', 2);
      } else if (packet.op === op.RequestGuildMembers) {
        requests.push(packet.d);
        reply(socket, op.Dispatch, { guild_id: packet.d.guild_id, nonce: packet.d.nonce, chunk_count: 1, chunk_index: 0, members: [{ user: { id: '1' }, roles: [] }] }, 'GUILD_MEMBERS_CHUNK', 3);
      } else if (packet.op === op.Heartbeat) {
        reply(socket, op.HeartbeatAck);
      }
    });
  });
  const outcomes = [];
  const session = new GatewaySession({ endpoint, token: 'fixture' }, {
    handler: async (event, signal) => {
      if (event.name !== 'WORK') return;
      outcomes.push((await session.requestGuildMembers('10', { signal })).length);
      outcomes.push(await session.requestGuildMembers('10', { signal }).catch((error) => error));
      outcomes.push((await session.requestGuildMembers('11', { signal })).length);
      outcomes.push((await session.requestGuildMembers('10', { query: 'a', limit: 5, signal })).length);
      controller.abort();
    },
  });
  await session.run({ signal: controller.signal });
  assert.equal(outcomes[0], 1);
  assert.ok(outcomes[1] instanceof GatewayRequestError);
  assert.equal(outcomes[1].opcode, op.RequestGuildMembers);
  assert.ok(outcomes[1].retryAfter >= 29 && outcomes[1].retryAfter <= 30, 'retryAfter ' + outcomes[1].retryAfter);
  assert.equal(outcomes[2], 1);
  assert.equal(outcomes[3], 1);
  assert.equal(requests.length, 3, 'the refused full-list request must not be sent');
});

test('keeps sized Gateway commands within three in flight so none is dropped by the server', { timeout: 8000 }, async (t) => {
  const { server, endpoint } = await gateway(t);
  const controller = new AbortController();
  t.after(() => controller.abort());
  const waiting = [];
  let peak = 0;
  server.on('connection', (socket) => {
    reply(socket, op.Hello, { heartbeat_interval: 100 });
    socket.on('message', (raw) => {
      const packet = JSON.parse(raw);
      if (packet.op === op.Identify) {
        reply(socket, op.Dispatch, { session_id: 's' }, 'READY', 1);
        reply(socket, op.Dispatch, {}, 'WORK', 2);
      } else if (packet.op === op.RequestGuildMembers || packet.op === op.RequestGuildCounts) {
        waiting.push({ socket, packet });
        peak = Math.max(peak, waiting.length);
        setTimeout(() => {
          const index = waiting.findIndex((entry) => entry.packet === packet);
          if (index >= 0) waiting.splice(index, 1);
          if (packet.op === op.RequestGuildCounts) {
            reply(socket, op.Dispatch, { nonce: packet.d.nonce, counts: [] }, 'GUILD_COUNTS_UPDATE', 3);
          } else {
            reply(socket, op.Dispatch, { guild_id: packet.d.guild_id, nonce: packet.d.nonce, chunk_count: 1, chunk_index: 0, members: [] }, 'GUILD_MEMBERS_CHUNK', 4);
          }
        }, 60);
      } else if (packet.op === op.Heartbeat) {
        reply(socket, op.HeartbeatAck);
      }
    });
  });
  const session = new GatewaySession({ endpoint, token: 'fixture' }, {
    handler: async (event, signal) => {
      if (event.name !== 'WORK') return;
      await Promise.all([
        ...Array.from({ length: 6 }, (_, index) => session.requestGuildCounts([String(10 + index)], { signal })),
        ...Array.from({ length: 4 }, (_, index) => session.requestGuildMembers(String(20 + index), { query: 'a', limit: 1, signal })),
      ]);
      controller.abort();
    },
  });
  await session.run({ signal: controller.signal });
  assert.ok(peak >= 2 && peak <= 3, 'peak in flight was ' + peak);
});

function tokenBucket({ limit, refillMs, id = 'bucket-a', latency = 8 }) {
  const state = { tokens: limit, last: performance.now(), denied: 0, active: 0, peak: 0, served: 0, firstWindowPeak: 0 };
  const rate = 1 / refillMs;
  const handler = async () => {
    state.active++;
    state.peak = Math.max(state.peak, state.active);
    await new Promise((resolve) => setTimeout(resolve, latency));
    const now = performance.now();
    state.tokens = Math.min(limit, state.tokens + (now - state.last) * rate);
    state.last = now;
    state.active--;
    if (state.tokens < 1) {
      state.denied++;
      const wait = (1 - state.tokens) / rate / 1000;
      return Response.json({ code: 'RATE_LIMITED', message: 'slow down', global: false, retry_after: wait }, {
        status: 429,
        headers: { 'retry-after': String(Math.ceil(wait)), 'x-ratelimit-bucket': id, 'x-ratelimit-limit': String(limit), 'x-ratelimit-remaining': '0', 'x-ratelimit-reset-after': String((limit / rate) / 1000) },
      });
    }
    state.tokens -= 1;
    state.served++;
    return Response.json({ id: '1' }, {
      headers: {
        'x-ratelimit-bucket': id, 'x-ratelimit-limit': String(limit), 'x-ratelimit-remaining': String(Math.floor(state.tokens)),
        'x-ratelimit-reset-after': String(((limit - state.tokens) / rate) / 1000),
      },
    });
  };
  return { state, handler };
}

test('never overruns a route bucket: a burst waits for tokens instead of being answered with 429', { timeout: 20000 }, async (t) => {
  const server = tokenBucket({ limit: 5, refillMs: 250 });
  const { bot } = await connect(t, server.handler);
  const started = performance.now();
  await Promise.all(Array.from({ length: 30 }, () => bot.channels.get('20')));
  const elapsed = performance.now() - started;
  assert.equal(server.state.denied, 0, 'the server denied ' + server.state.denied + ' requests');
  assert.equal(server.state.served, 30);
  assert.ok(elapsed >= 1000, 'the burst was not spread out: ' + elapsed);
});

test('learns an unknown bucket with one request before it sends more', { timeout: 10000 }, async (t) => {
  const server = tokenBucket({ limit: 50, refillMs: 100, latency: 40 });
  let concurrentAtStart;
  const { bot } = await connect(t, async (call, init) => {
    const result = await server.handler(call, init);
    return result;
  });
  const first = bot.channels.get('20');
  const others = Array.from({ length: 9 }, () => bot.channels.get('20'));
  await new Promise((resolve) => setTimeout(resolve, 15));
  concurrentAtStart = server.state.active;
  await Promise.all([first, ...others]);
  assert.equal(concurrentAtStart, 1, 'more than one request was in flight before the bucket was known');
  assert.ok(server.state.peak > 1, 'later requests should run concurrently once the bucket is known');
  assert.equal(server.state.denied, 0);
});

test('routes that share a bucket id share its allowance', { timeout: 20000 }, async (t) => {
  const server = tokenBucket({ limit: 4, refillMs: 200, id: 'shared' });
  const { bot } = await connect(t, server.handler);
  const started = performance.now();
  await Promise.all([
    ...Array.from({ length: 10 }, () => bot.channels.get('20')),
    ...Array.from({ length: 10 }, () => bot.guilds.get('10')),
  ]);
  assert.ok(server.state.denied <= 1, 'the server denied ' + server.state.denied + ' requests');
  assert.equal(server.state.served, 20);
  assert.ok(performance.now() - started >= 600);
});

test('does not slow routes whose responses carry no rate limit headers', { timeout: 10000 }, async (t) => {
  let active = 0;
  let peak = 0;
  const { bot } = await connect(t, async () => {
    active++;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 20));
    active--;
    return ok();
  });
  const started = performance.now();
  await Promise.all(Array.from({ length: 40 }, () => bot.users.get('5')));
  assert.ok(peak >= 30, 'peak concurrency was only ' + peak);
  assert.ok(performance.now() - started < 600);
});

test('a failed request does not leave a bucket waiting forever', { timeout: 10000 }, async (t) => {
  let first = true;
  const { bot } = await connect(t, async () => {
    if (first) {
      first = false;
      throw new Error('network down');
    }
    return ok();
  }, { maxRestAttempts: 1 });
  await assert.rejects(bot.channels.get('20'), /connection failed/);
  await bot.channels.get('20');
});
