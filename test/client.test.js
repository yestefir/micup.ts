import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MicupAPIError, MicupClient } from 'micup.ts';

const origin = 'https://micup.example';
const bot = { id: '101', username: 'fixture', bot: true };

test('discovers the API, authenticates the bot and sends replies', async (t) => {
  const payload = {
    content: 'Merhaba!',
    message_reference: { message_id: '303', channel_id: '202' },
  };
  const message = { id: '404', channel_id: '202', content: payload.content, author: bot };
  const fetch = t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(options.redirect, 'error');
    if (String(url) === origin + '/.well-known/fluxer') {
      assert.equal(options.headers, undefined);
      return Response.json({ endpoints: { api_public: origin + '/api/' } });
    }
    assert.equal(options.headers.get('Authorization'), 'Bot fixture');
    if (String(url) === origin + '/api/v1/users/@me') {
      return Response.json(bot);
    }
    assert.equal(String(url), origin + '/api/v1/channels/202/messages');
    assert.equal(options.method, 'POST');
    assert.deepEqual(JSON.parse(options.body), payload);
    return Response.json(message);
  });

  const client = await MicupClient.connect({ token: 'fixture', origin });
  assert.deepEqual(await client.getCurrentUser(), bot);
  assert.match(client.botInviteURL({ scopes: ['bot', 'applications.commands'] }), /scope=bot\+applications.commands/);
  assert.throws(() => client.botInviteURL({ scopes: Array(1) }), TypeError);
  assert.deepEqual(await client.sendMessage('202', 'Merhaba!', { replyTo: '303' }), message);
  assert.throws(() => client.sendMessage('..', 'test'), /Channel ID/);
  assert.throws(() => client.sendMessage('202', { content: 'test', sticker_ids: '12' }), TypeError);
  assert.throws(() => client.sendMessage('202', { content: 'test', sticker_ids: ['invalid'] }), TypeError);
  assert.throws(() => client.sendMessage('202', { content: 'test', allowed_mentions: { parse: ['unknown'] } }), TypeError);
  assert.throws(() => client.sendMessage('202', { content: 'test', allowed_mentions: { users: ['invalid'] } }), TypeError);
  assert.throws(() => client.sendMessage('202', { content: 'test', allowed_mentions: { replied_user: 'yes' } }), TypeError);
  assert.throws(() => client.sendMessage('202', { content: 'test', uploads: [{}] }), TypeError);
  assert.throws(() => client.sendMessage('202', { content: 'test', uploads: 'invalid' }), TypeError);
  assert.throws(() => client.sendMessage('202', { content: 'test', files: Array(1) }), TypeError);
  assert.throws(() => client.sendMessage('202', { content: 'test', files: [null] }), TypeError);
  assert.throws(() => client.sendMessage('202', { content: 'test', attachments: 'invalid' }), TypeError);
  assert.throws(() => client.sendMessage('202', { content: 'test', attachments: [{ id: 'invalid' }] }), TypeError);
  assert.throws(() => client.sendMessage('202', { content: 'test', attachments: [{ id: '12' }, { id: '12' }] }), TypeError);
  assert.equal(fetch.mock.callCount(), 4);
});

test('an aborted application lookup does not cancel an uncancelled lookup', async (t) => {
  const application = { id: '102', name: 'Fixture' };
  let markStarted;
  const started = new Promise((resolve) => { markStarted = resolve; });
  const fetch = t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (String(url) === origin + '/.well-known/fluxer') return Response.json({ endpoints: { api_public: origin + '/api' } });
    if (String(url) === origin + '/api/v1/users/@me') return Response.json(bot);
    if (String(url) === origin + '/api/v1/applications/@me' && options.signal) {
      markStarted();
      return new Promise((resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
      });
    }
    assert.equal(String(url), origin + '/api/v1/applications/@me');
    return Response.json(application);
  });

  const client = await MicupClient.connect({ token: 'fixture', origin });
  const controller = new AbortController();
  const cancelled = client.application({ signal: controller.signal });
  await started;
  const uncancelled = client.application();
  controller.abort(new Error('caller stopped waiting'));

  await assert.rejects(cancelled, /caller stopped waiting/);
  assert.deepEqual(await uncancelled, application);
  assert.equal(fetch.mock.callCount(), 4);
});

test('recommends shards from service limits and guild count', async (t) => {
  let guildIds = ['1'];
  let serviceShards = 4;
  let failGateway = false;
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (String(url) === origin + '/.well-known/fluxer') return Response.json({ endpoints: { api_public: origin + '/api' } });
    if (String(url) === origin + '/api/v1/users/@me') return Response.json(bot);
    const target = new URL(url);
    calls.push(target.pathname + target.search);
    if (target.pathname === '/api/v1/users/@me/guilds') {
      const after = target.searchParams.get('after');
      const offset = after === null ? 0 : guildIds.indexOf(after) + 1;
      return Response.json(guildIds.slice(offset, offset + 200).map((id) => ({ id })));
    }
    if (target.pathname === '/api/v1/gateway/bot') {
      if (failGateway) return Response.json({ message: 'Unavailable' }, { status: 503 });
      return Response.json({ shards: serviceShards });
    }
    assert.fail('Unexpected request: ' + options.method + ' ' + target.pathname);
  });

  const client = await MicupClient.connect({ token: 'fixture', origin, maxRestAttempts: 1 });
  assert.equal(await client.recommendedShards(), 4);
  guildIds = Array.from({ length: 2001 }, (_, index) => String(index + 1));
  serviceShards = 1;
  assert.equal(await client.recommendedShards(), 2);
  guildIds = [];
  failGateway = true;
  assert.equal(await client.recommendedShards(), 1);
  assert.ok(calls.includes('/api/v1/users/@me/guilds?limit=200&after=200'));
  assert.equal(calls.filter((path) => path.startsWith('/api/v1/gateway/bot')).length, 3);
});

test('rejects discovery on a different origin before sending the token', async (t) => {
  const fetch = t.mock.method(globalThis, 'fetch', async () =>
    Response.json({ endpoints: { api_public: 'https://other.example/api' } }),
  );
  await assert.rejects(MicupClient.connect({ token: 'fixture', origin }), /invalid API endpoint/);
  assert.equal(fetch.mock.callCount(), 1);
});

test('rejects bot identity responses without a numeric bot ID', async (t) => {
  const identities = [
    { username: 'missing-id', bot: true },
    { id: 'not-a-snowflake', username: 'invalid-id', bot: true },
  ];
  let index = 0;
  const fetch = t.mock.method(globalThis, 'fetch', async (url) => {
    if (String(url) === origin + '/.well-known/fluxer') {
      return Response.json({ endpoints: { api_public: origin + '/api' } });
    }
    return Response.json(identities[index++]);
  });

  for (let item = 0; item < identities.length; item++) {
    await assert.rejects(MicupClient.connect({ token: 'fixture', origin }), /valid bot ID/);
  }
  assert.equal(index, identities.length);
  assert.equal(fetch.mock.callCount(), identities.length * 2);
});

test('rejects malformed discovery documents before authenticating', async (t) => {
  const documents = [
    null,
    { endpoints: null },
    { endpoints: [] },
    { endpoints: { api_public: 'not a URL' } },
    { endpoints: { api_public: origin + '/api', gateway: 'not a URL' } },
  ];
  let index = 0;
  const fetch = t.mock.method(globalThis, 'fetch', async () => Response.json(documents[index++]));

  for (let item = 0; item < documents.length; item++) {
    await assert.rejects(MicupClient.connect({ token: 'fixture', origin }), /Micup discovery returned an invalid/);
  }
  assert.equal(index, documents.length);
  assert.equal(fetch.mock.callCount(), documents.length);
});

test('exposes HTTP rate limit details', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url) => {
    if (String(url) === origin + '/.well-known/fluxer') {
      return Response.json({ endpoints: { api_public: origin + '/api' } });
    }
    return Response.json({
      message: 'Slow down',
      errors: [
        { path: 'content', code: 'EMPTY', message: 'Content is empty' },
        null,
        { path: 4, code: 'INVALID', message: 'Malformed field error' },
      ],
    }, {
      status: 429,
      headers: { 'Retry-After': '2' },
    });
  });

  await assert.rejects(MicupClient.connect({ token: 'fixture', origin, maxRestAttempts: 1 }), (error) => {
    assert.ok(error instanceof MicupAPIError);
    assert.equal(error.status, 429);
    assert.equal(error.retryAfter, '2');
    assert.deepEqual(error.errors, [{ path: 'content', code: 'EMPTY', message: 'Content is empty' }]);
    return true;
  });
});

test('parses an HTTP-date Retry-After header', async (t) => {
  const retryAt = new Date(Date.now() + 10_000).toUTCString();
  t.mock.method(globalThis, 'fetch', async (url) => {
    if (String(url) === origin + '/.well-known/fluxer') {
      return Response.json({ endpoints: { api_public: origin + '/api' } });
    }
    return Response.json({ message: 'Slow down' }, { status: 429, headers: { 'Retry-After': retryAt } });
  });

  await assert.rejects(MicupClient.connect({ token: 'fixture', origin, maxRestAttempts: 1 }), (error) => {
    assert.ok(error instanceof MicupAPIError);
    assert.equal(error.retryAfter, retryAt);
    assert.ok(error.retryAfterMs > 0 && error.retryAfterMs <= 10_000);
    return true;
  });
});

test('preserves the original REST connection failure as the error cause', async (t) => {
  const cause = new TypeError('fixture socket failure');
  t.mock.method(globalThis, 'fetch', async (url) => {
    if (String(url) === origin + '/.well-known/fluxer') {
      return Response.json({ endpoints: { api_public: origin + '/api' } });
    }
    throw cause;
  });

  await assert.rejects(MicupClient.connect({ token: 'fixture', origin, maxRestAttempts: 1 }), (error) => {
    assert.equal(error.message, 'Micup API connection failed');
    assert.equal(error.cause, cause);
    return true;
  });
});

test('reports malformed successful REST JSON with its parse error as the cause', async (t) => {
  const fetch = t.mock.method(globalThis, 'fetch', async (url) => {
    if (String(url) === origin + '/.well-known/fluxer') {
      return Response.json({ endpoints: { api_public: origin + '/api' } });
    }
    if (String(url) === origin + '/api/v1/users/@me') return Response.json(bot);
    return new Response('<html>not JSON</html>', { status: 200 });
  });
  const client = await MicupClient.connect({ token: 'fixture', origin });

  await assert.rejects(client.request('GET', '/malformed'), (error) => {
    assert.equal(error.message, 'Micup API returned invalid JSON');
    assert.ok(error.cause instanceof SyntaxError);
    return true;
  });
  assert.equal(fetch.mock.callCount(), 3);
});

test('preserves the abort reason while reading a successful REST response', async (t) => {
  let markBodyWaiting;
  const bodyWaiting = new Promise((resolve) => { markBodyWaiting = resolve; });
  const fetch = t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (String(url) === origin + '/.well-known/fluxer') {
      return Response.json({ endpoints: { api_public: origin + '/api' } });
    }
    if (String(url) === origin + '/api/v1/users/@me') return Response.json(bot);
    let streamController;
    const body = new ReadableStream({
      start(controller) {
        streamController = controller;
        controller.enqueue(new TextEncoder().encode('{"partial":'));
      },
      pull: () => markBodyWaiting(),
    });
    options.signal.addEventListener('abort', () => streamController.error(new Error('reader stopped')), { once: true });
    return new Response(body, { headers: { 'Content-Type': 'application/json' } });
  });
  const client = await MicupClient.connect({ token: 'fixture', origin });
  const controller = new AbortController();
  const reason = new Error('request cancelled');
  const request = client.request('GET', '/slow', { signal: controller.signal });
  await bodyWaiting;
  controller.abort(reason);

  await assert.rejects(request, (error) => error === reason);
  assert.equal(fetch.mock.callCount(), 3);
});

test('retries an explicit rate limit, preserves file metadata, and never retries an ambiguous POST', async (t) => {
  let attempts = 0;
  const fetch = t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (String(url) === origin + '/.well-known/fluxer') {
      return Response.json({ endpoints: { api_public: origin + '/api' } });
    }
    if (String(url).endsWith('/users/@me')) return Response.json(bot);
    assert.equal(String(url), origin + '/api/v1/channels/202/messages');
    assert.equal(options.method, 'POST');
    if (++attempts === 1) return Response.json({ retry_after: 0.001 }, { status: 429 });
    if (attempts === 2) {
      assert.equal(options.headers.get('Content-Type'), null);
      assert.equal(await options.body.get('files[0]').text(), 'fixture');
      assert.deepEqual(JSON.parse(options.body.get('payload_json')), {
        content: 'file',
        attachments: [{ id: 0, filename: 'fixture.txt', description: 'fixture' }],
      });
      return Response.json({ id: '42' });
    }
    return Response.json({ code: 'SERVER_ERROR' }, { status: 503 });
  });

  const client = await MicupClient.connect({ token: 'fixture', origin });
  const sent = await client.sendMessage('202', {
    content: 'file',
    files: [{ name: 'fixture.txt', data: new Blob(['fixture']), description: 'fixture' }],
  });
  assert.equal(sent.id, '42');
  await assert.rejects(client.sendMessage('202', 'ambiguous'), (error) => error.status === 503);
  assert.equal(attempts, 3);
  await assert.rejects(client.request('GET', '/%2e%2e/escape'), /relative to the versioned API/);
  await assert.rejects(client.request('GET', '/users/../users/@me'), /relative to the versioned API/);
  await assert.rejects(client.request('GET', '/users/%2e%2e/users/@me'), /relative to the versioned API/);
  assert.equal(fetch.mock.callCount(), 5);
});
