import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MicupClient, Permission } from 'micup.ts';

test('uses Micup role, member moderation, channel and reaction routes', async (t) => {
  const origin = 'https://micup.example';
  const requests = [
    ['POST', '/api/v1/guilds/10/roles', { name: 'Moderator', permissions: String(Permission.ViewChannelMembers) }, { id: '70' }],
    ['PUT', '/api/v1/guilds/10/members/20/roles/70', undefined, undefined],
    ['PUT', '/api/v1/guilds/10/bans/20', { delete_message_seconds: 600 }, undefined],
    ['PATCH', '/api/v1/channels/30', { topic: null }, { id: '30', topic: null }],
    ['POST', '/api/v1/channels/30/messages/40/threads', { name: 'Thread' }, { id: '50' }],
    ['PUT', '/api/v1/channels/30/messages/40/reactions/%F0%9F%91%8D/@me', undefined, undefined],
  ];
  const fetch = t.mock.method(globalThis, 'fetch', async (url, options) => {
    const { pathname } = new URL(url);
    if (pathname === '/.well-known/fluxer') return Response.json({ endpoints: { api_public: origin + '/api' } });
    if (pathname === '/api/v1/users/@me') return Response.json({ id: '99', bot: true });
    const [method, path, body, response] = requests.shift();
    assert.equal(options.method, method);
    assert.equal(pathname, path);
    assert.deepEqual(options.body ? JSON.parse(options.body) : undefined, body);
    if (pathname.endsWith('/bans/20')) assert.equal(options.headers.get('X-Audit-Log-Reason'), 'cleanup');
    return response ? Response.json(response) : new Response(null, { status: 204 });
  });

  const bot = await MicupClient.connect({ origin, token: 'fixture' });
  assert.throws(() => bot.guilds.ban('10', '20', { ban_duration_seconds: 5 }), /Invalid/);
  const role = await bot.guilds.createRole('10', { name: 'Moderator', permissions: Permission.ViewChannelMembers });
  await bot.guilds.addMemberRole('10', '20', role.id);
  await bot.guilds.ban('10', '20', { delete_message_seconds: 600 }, { reason: 'cleanup' });
  assert.equal((await bot.channels.edit('30', { topic: null })).topic, null);
  assert.equal((await bot.channels.startThread('30', { name: 'Thread' }, { messageId: '40' })).id, '50');
  await bot.channels.addReaction('30', '40', '👍');
  assert.equal(requests.length, 0);
  assert.equal(fetch.mock.callCount(), 8);
});
