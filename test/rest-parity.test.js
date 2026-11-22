import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MicupClient } from 'micup.ts';

const origin = 'https://micup.example';

async function mockBot(t, handler) {
  const fetch = t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (String(url) === origin + '/.well-known/fluxer') {
      return Response.json({ endpoints: { api_public: origin + '/api' } });
    }
    if (String(url) === origin + '/api/v1/users/@me') return Response.json({ id: '77', bot: true });
    return handler(new URL(url), options);
  });
  return { bot: await MicupClient.connect({ origin, token: 'fixture' }), fetch };
}

test('uploads signed multipart slices anonymously and references completed attachments', async (t) => {
  const calls = [];
  const { bot } = await mockBot(t, async (url, options) => {
    calls.push(url.href);
    if (url.hostname === 'storage.example') {
      assert.equal(options.headers.get('Authorization'), null);
      assert.equal(options.redirect, 'error');
      assert.equal(options.method, 'PUT');
      assert.equal(await options.body.text(), url.pathname === '/one' ? 'abc' : 'de');
      return new Response(null, { status: 204 });
    }
    assert.equal(options.headers.get('Authorization'), 'Bot fixture');
    const body = JSON.parse(options.body);
    if (url.pathname === '/api/v1/channels/20/attachments') {
      assert.deepEqual(body.attachments, [{ id: 0, filename: 'sample.txt', file_size: 5, content_type: 'text/plain' }]);
      return Response.json({ attachments: [{
        upload_filename: 'uploads/example', upload_mode: 'multipart', upload_id: 'fixture-upload', part_size: 3,
        parts: [
          { part_number: 2, upload_url: 'https://storage.example/two' },
          { part_number: 1, upload_url: 'https://storage.example/one' },
        ],
      }] });
    }
    if (url.pathname.endsWith('/complete')) {
      assert.deepEqual(body, { uploads: [{ upload_filename: 'uploads/example', upload_id: 'fixture-upload' }] });
      return new Response(null, { status: 204 });
    }
    assert.deepEqual(body, {
      attachments: [{
        id: 0, filename: 'sample.txt', file_size: 5, content_type: 'text/plain',
        upload_filename: 'uploads/example', description: 'fixture',
      }],
    });
    return Response.json({ id: '99' });
  });

  const upload = await bot.attachments.upload('20', {
    name: 'sample.txt', data: new Blob(['abcde'], { type: 'text/plain' }), description: 'fixture',
  });
  assert.equal((await bot.sendMessage('20', { uploads: [upload] })).id, '99');
  assert.deepEqual(calls.slice(1, 3), ['https://storage.example/one', 'https://storage.example/two']);
});

test('validates every signed upload URL before writing any part', async (t) => {
  const { bot, fetch } = await mockBot(t, (url) => {
    assert.equal(url.pathname, '/api/v1/channels/20/attachments');
    return Response.json({ attachments: [{
      upload_filename: 'uploads/example', upload_mode: 'multipart', upload_id: 'fixture-upload', part_size: 2,
      parts: [
        { part_number: 1, upload_url: 'https://storage.example/one' },
        { part_number: 2, upload_url: 'https://user:pass@storage.example/two' },
      ],
    }] });
  });
  await assert.rejects(bot.attachments.upload('20', { name: 'sample', data: new Blob(['1234']) }), /invalid upload URL/);
  assert.equal(fetch.mock.callCount(), 3);
});

test('uses token-only webhook requests, forwards messages and searches in context', async (t) => {
  const { bot, fetch } = await mockBot(t, (url, options) => {
    if (url.pathname.startsWith('/api/v1/webhooks/60/')) {
      assert.equal(options.headers.get('Authorization'), null);
      assert.equal(url.pathname, '/api/v1/webhooks/60/test%2Ftoken');
      assert.equal(url.search, '?thread_id=30&wait=true');
      assert.deepEqual(JSON.parse(options.body), { content: 'hello', username: 'fixture' });
      return Response.json({ id: '91' });
    }
    if (url.pathname.endsWith('/search/messages')) {
      assert.deepEqual(JSON.parse(options.body), { context_guild_id: '10', pinned: false, page: 1 });
      return Response.json({ messages: [{ id: '90' }], total: 1 });
    }
    assert.equal(url.pathname, '/api/v1/channels/30/messages');
    assert.deepEqual(JSON.parse(options.body), {
      message_reference: { type: 1, channel_id: '20', message_id: '90', attachment_ids: ['80'] },
    });
    return Response.json({ id: '92' });
  });
  assert.equal((await bot.webhooks.execute('60', 'test/token', 'hello', { threadId: '30', wait: true, username: 'fixture' })).id, '91');
  assert.equal((await bot.searchMessages({ context_guild_id: '10', pinned: false, page: 1 })).total, 1);
  assert.equal((await bot.forwardMessage('30', { channel_id: '20', message_id: '90', attachment_ids: ['80'] })).id, '92');
  assert.equal(fetch.mock.callCount(), 5);
});

test('keeps forum message attachments inside the starter message payload', async (t) => {
  const { bot } = await mockBot(t, async (url, options) => {
    assert.equal(url.pathname, '/api/v1/channels/20/threads');
    assert.equal(await options.body.get('files[0]').text(), 'fixture');
    assert.deepEqual(JSON.parse(options.body.get('payload_json')), {
      name: 'Forum topic',
      applied_tags: ['25'],
      message: {
        content: 'First message',
        allowed_mentions: { users: ['77'], parse: [] },
        attachments: [{ id: 0, filename: 'data.txt' }],
      },
    });
    return Response.json({ id: '30', message: { id: '31' } });
  });
  const thread = await bot.channels.createForumPost('20', {
    name: 'Forum topic',
    applied_tags: ['25'],
    message: {
      content: 'First message',
      allowed_mentions: { users: ['77'] },
      files: [{ name: 'data.txt', data: new Blob(['fixture']) }],
    },
  });
  assert.equal(thread.message.id, '31');
});
