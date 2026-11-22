import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MicupAPIError, MicupClient } from 'micup-js';

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
  assert.deepEqual(await client.sendMessage('202', 'Merhaba!', { replyTo: '303' }), message);
  assert.throws(() => client.sendMessage('..', 'test'), /Channel ID/);
  assert.equal(fetch.mock.callCount(), 4);
});

test('rejects discovery on a different origin before sending the token', async (t) => {
  const fetch = t.mock.method(globalThis, 'fetch', async () =>
    Response.json({ endpoints: { api_public: 'https://other.example/api' } }),
  );
  await assert.rejects(MicupClient.connect({ token: 'fixture', origin }), /invalid API endpoint/);
  assert.equal(fetch.mock.callCount(), 1);
});

test('exposes HTTP rate limit details', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url) => {
    if (String(url) === origin + '/.well-known/fluxer') {
      return Response.json({ endpoints: { api_public: origin + '/api' } });
    }
    return Response.json({ message: 'Slow down' }, {
      status: 429,
      headers: { 'Retry-After': '2' },
    });
  });

  await assert.rejects(MicupClient.connect({ token: 'fixture', origin }), (error) => {
    assert.ok(error instanceof MicupAPIError);
    assert.equal(error.status, 429);
    assert.equal(error.retryAfter, '2');
    return true;
  });
});
