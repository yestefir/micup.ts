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

test('rejects malformed upload plans before sending attachment data', async (t) => {
  const plans = [
    { attachments: { length: 1, 0: { upload_filename: 'uploads/example', upload_mode: 'singlepart', upload_url: 'https://storage.example/upload' } } },
    { attachments: [{ upload_filename: 'uploads/example', upload_mode: 'multipart', upload_id: 'fixture', part_size: 2, parts: [null] }] },
  ];
  const { bot, fetch } = await mockBot(t, (url) => {
    assert.equal(url.pathname, '/api/v1/channels/20/attachments');
    return Response.json(plans.shift());
  });

  await assert.rejects(bot.attachments.upload('20', { name: 'sample', data: new Blob(['1234']) }), /invalid upload plan/);
  await assert.rejects(bot.attachments.upload('20', { name: 'sample', data: new Blob(['1234']) }), /invalid multipart upload plan/);
  assert.equal(fetch.mock.callCount(), 4);
});

test('rejects public cleartext upload URLs before sending attachment data', async (t) => {
  const { bot, fetch } = await mockBot(t, (url) => {
    assert.equal(url.pathname, '/api/v1/channels/20/attachments');
    return Response.json({ attachments: [{
      upload_filename: 'uploads/example', upload_mode: 'singlepart', upload_url: 'http://storage.example/upload',
    }] });
  });
  await assert.rejects(bot.attachments.upload('20', { name: 'sample', data: new Blob(['fixture']) }), /invalid upload URL/);
  assert.equal(fetch.mock.callCount(), 3);
});

test('allows loopback HTTP upload URLs for local testing', async (t) => {
  const { bot } = await mockBot(t, async (url, options) => {
    if (url.pathname === '/api/v1/channels/20/attachments') {
      return Response.json({ attachments: [{
        upload_filename: 'uploads/example', upload_mode: 'singlepart', upload_url: 'http://127.0.0.1:8080/upload',
      }] });
    }
    assert.equal(url.href, 'http://127.0.0.1:8080/upload');
    assert.equal(options.headers.get('Authorization'), null);
    return new Response(null, { status: 204 });
  });
  const uploaded = await bot.attachments.upload('20', { name: 'sample', data: new Blob(['fixture']) });
  assert.equal(uploaded.upload_filename, 'uploads/example');
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

test('covers webhook management, thread options and token-authenticated message routes', async (t) => {
  const calls = [];
  const { bot } = await mockBot(t, async (url, options) => {
    calls.push({
      method: options.method,
      path: url.pathname,
      query: url.search,
      authorization: options.headers.get('Authorization'),
      reason: options.headers.get('X-Audit-Log-Reason'),
      body: typeof options.body === 'string' ? JSON.parse(options.body) : undefined,
    });
    return options.method === 'DELETE' ? new Response(null, { status: 204 }) : Response.json({ id: '60' });
  });

  await bot.webhooks.channel('20');
  await bot.webhooks.guild('10');
  await bot.webhooks.create('20', 'fixture', { avatar: 'data:image/png;base64,AA==', reason: 'test' });
  await bot.webhooks.get('60');
  await bot.webhooks.get('60', { token: 'webhook/token' });
  await bot.webhooks.edit('60', { name: 'renamed', channel_id: '21' }, { reason: 'move' });
  await bot.webhooks.edit('60', { avatar: null }, { token: 'webhook/token' });
  await bot.webhooks.delete('60', { reason: 'remove' });
  await bot.webhooks.delete('60', { token: 'webhook/token' });
  await bot.webhooks.execute('60', 'webhook/token', { content: 'forum', files: [] }, {
    threadName: 'Fixture thread', appliedTags: ['40'], username: 'speaker', avatarURL: 'https://cdn.example/avatar.png',
  });
  await bot.webhooks.message('60', 'webhook/token', '70', { threadId: '30' });
  await bot.webhooks.editMessage('60', 'webhook/token', '70', { content: 'edited' });
  await bot.webhooks.deleteMessage('60', 'webhook/token', '70');

  assert.deepEqual(calls.map(({ method, path }) => [method, path]), [
    ['GET', '/api/v1/channels/20/webhooks'],
    ['GET', '/api/v1/guilds/10/webhooks'],
    ['POST', '/api/v1/channels/20/webhooks'],
    ['GET', '/api/v1/webhooks/60'],
    ['GET', '/api/v1/webhooks/60/webhook%2Ftoken'],
    ['PATCH', '/api/v1/webhooks/60'],
    ['PATCH', '/api/v1/webhooks/60/webhook%2Ftoken'],
    ['DELETE', '/api/v1/webhooks/60'],
    ['DELETE', '/api/v1/webhooks/60/webhook%2Ftoken'],
    ['POST', '/api/v1/webhooks/60/webhook%2Ftoken'],
    ['GET', '/api/v1/webhooks/60/webhook%2Ftoken/messages/70'],
    ['PATCH', '/api/v1/webhooks/60/webhook%2Ftoken/messages/70'],
    ['DELETE', '/api/v1/webhooks/60/webhook%2Ftoken/messages/70'],
  ]);
  assert.equal(calls[2].authorization, 'Bot fixture');
  assert.equal(calls[2].reason, 'test');
  assert.deepEqual(calls[5].body, { name: 'renamed', channel_id: '21' });
  assert.equal(calls[6].authorization, null);
  assert.deepEqual(calls[9].body, {
    content: 'forum', username: 'speaker', avatar_url: 'https://cdn.example/avatar.png',
    thread_name: 'Fixture thread', applied_tags: ['40'],
  });
  assert.equal(calls[9].authorization, null);
  assert.equal(calls[9].query, '');
  assert.equal(calls[10].query, '?thread_id=30');

  assert.throws(() => bot.webhooks.get('60', { token: '..' }), /webhook token/);
  assert.throws(() => bot.webhooks.edit('60', {}, {}), /need a change/);
  assert.throws(() => bot.webhooks.edit('60', { channel_id: '21' }, { token: 'webhook/token' }), /must move/);
  assert.throws(() => bot.webhooks.execute('60', 'token', ''), /needs content/);
  assert.throws(() => bot.webhooks.execute('60', 'token', { content: 'x', components: [{}] }), /cannot carry components/);
  assert.throws(() => bot.webhooks.execute('60', 'token', 'x', { threadId: '30', threadName: 'new' }), /either an existing thread/);
  assert.throws(() => bot.webhooks.execute('60', 'token', 'x', { appliedTags: ['40'] }), /up to five tags/);
  assert.throws(() => bot.webhooks.execute('60', 'token', 'x', { threadName: 'new', appliedTags: '40' }), TypeError);
  assert.throws(() => bot.webhooks.execute('60', 'token', 'x', { threadName: 'new', appliedTags: Array(1) }), TypeError);
  assert.throws(() => bot.webhooks.execute('60', 'token', 'x', { threadName: 'new', appliedTags: ['invalid'] }), TypeError);
  assert.throws(() => bot.webhooks.editMessage('60', 'token', '70', {}), /need a change/);
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
  assert.throws(() => bot.channels.createForumPost('20', {
    name: 'Forum topic', applied_tags: '25', message: { content: 'First message' },
  }), TypeError);
  assert.throws(() => bot.channels.createForumPost('20', {
    name: 'Forum topic', applied_tags: Array(1), message: { content: 'First message' },
  }), TypeError);
  assert.throws(() => bot.channels.createForumPost('20', {
    name: 'Forum topic', applied_tags: ['invalid'], message: { content: 'First message' },
  }), TypeError);
});

test('sends timed moderation and announcement follower requests through resource APIs', async (t) => {
  const { bot } = await mockBot(t, (url, options) => {
    const body = JSON.parse(options.body);
    if (url.pathname.endsWith('/followers')) {
      assert.equal(options.method, 'POST');
      assert.deepEqual(body, { webhook_channel_id: '32' });
      return Response.json({ channel_id: '32', webhook_id: '62' });
    }
    assert.equal(url.pathname, '/api/v1/guilds/10/members/33');
    assert.equal(options.method, 'PATCH');
    if (body.communication_disabled_until) {
      assert.ok(Date.parse(body.communication_disabled_until) > Date.now());
      assert.equal(body.timeout_reason, 'fixture');
    } else assert.deepEqual(body, { communication_disabled_until: null });
    return Response.json({ roles: [] });
  });
  await bot.guilds.timeout('10', '33', 60000, { timeoutReason: 'fixture' });
  await bot.guilds.clearTimeout('10', '33');
  assert.equal((await bot.channels.follow('31', '32')).webhook_id, '62');
});
