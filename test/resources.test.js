import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MicupClient, Permission } from 'micup.ts';

test('validates guild updates against editable API fields', async (t) => {
  const origin = 'https://micup.example';
  const sent = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const { pathname } = new URL(url);
    if (pathname === '/.well-known/fluxer') return Response.json({ endpoints: { api_public: origin + '/api' } });
    if (pathname === '/api/v1/users/@me') return Response.json({ id: '99', bot: true });
    sent.push(JSON.parse(options.body));
    return Response.json({ id: '10', name: 'Updated' });
  });
  const bot = await MicupClient.connect({ origin, token: 'fixture' });
  assert.throws(() => bot.guilds.edit('10', null), /must be an object/);
  assert.throws(() => bot.guilds.edit('10', { name: '' }), /1 to 100/);
  assert.throws(() => bot.guilds.edit('10', { afk_timeout: 59 }), RangeError);
  assert.throws(() => bot.guilds.edit('10', { verification_level: 4 }), RangeError);
  assert.throws(() => bot.guilds.edit('10', { nsfw_level: 2 }), RangeError);
  assert.throws(() => bot.guilds.edit('10', { features: Array(101).fill('VISITS_ENABLED') }), /up to 100/);
  assert.throws(() => bot.guilds.edit('10', { system_channel_id: 'invalid' }), /numeric string/);
  assert.throws(() => bot.guilds.edit('10', { message_history_cutoff: 'tomorrow' }), /ISO 8601/);
  assert.throws(() => bot.guilds.edit('10', { owner_id: '20' }), /do not support the owner_id field/);
  await bot.guilds.edit('10', {
    name: 'Updated',
    afk_timeout: 300,
    system_channel_id: null,
    features: ['VISITS_ENABLED'],
    message_history_cutoff: null,
  });
  assert.deepEqual(sent, [{
    name: 'Updated',
    afk_timeout: 300,
    system_channel_id: null,
    features: ['VISITS_ENABLED'],
    message_history_cutoff: null,
  }]);
});

test('uses Micup role, member moderation, channel and reaction routes', async (t) => {
  const origin = 'https://micup.example';
  const requests = [
    ['POST', '/api/v1/guilds/10/roles', { name: 'Moderator', permissions: String(Permission.ViewChannelMembers) }, { id: '70' }],
    ['PUT', '/api/v1/guilds/10/members/20/roles/70', undefined, undefined],
    ['PUT', '/api/v1/guilds/10/bans/20', { delete_message_seconds: 600 }, undefined],
    ['PATCH', '/api/v1/channels/30', { topic: null }, { id: '30', topic: null }],
    ['POST', '/api/v1/channels/30/messages/40/threads', { name: 'Thread', rate_limit_per_user: 21_600 }, { id: '50' }],
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
  assert.throws(() => bot.guilds.createRole('10', null), /must be an object/);
  assert.throws(() => bot.guilds.createRole('10', {}), /needs a nonempty name/);
  assert.throws(() => bot.guilds.createRole('10', { name: 'x'.repeat(101) }), RangeError);
  assert.throws(() => bot.guilds.createRole('10', { name: 'Moderator', color: 0x1000000 }), RangeError);
  assert.throws(() => bot.guilds.createRole('10', { name: 'Moderator', permissions: '-1' }), /unsigned 64-bit/);
  assert.throws(() => bot.guilds.editRole('10', '70', { permissions: (1n << 64n).toString() }), /unsigned 64-bit/);
  assert.throws(() => bot.guilds.editRole('10', '70', { hoist: 'yes' }), /must be booleans/);
  assert.throws(() => bot.guilds.editRole('10', '70', { mentionable: 1 }), /must be booleans/);
  assert.throws(() => bot.guilds.editRole('10', '70', { icon: '' }), /nonempty strings/);
  assert.throws(() => bot.channels.startThread('30', { name: 'Thread', rate_limit_per_user: -1 }), RangeError);
  assert.throws(() => bot.channels.startThread('30', { name: 'Thread', rate_limit_per_user: 21_601 }), RangeError);
  assert.throws(() => bot.channels.startThread('30', { name: 'Thread', rate_limit_per_user: 1.5 }), RangeError);
  assert.throws(() => bot.channels.startThread('30', { name: 'Thread', invitable: 'yes' }), TypeError);
  assert.throws(() => bot.channels.startThread('30', { name: 'Thread', type: 99 }), RangeError);
  const role = await bot.guilds.createRole('10', { name: 'Moderator', permissions: Permission.ViewChannelMembers });
  await bot.guilds.addMemberRole('10', '20', role.id);
  await bot.guilds.ban('10', '20', { delete_message_seconds: 600 }, { reason: 'cleanup' });
  assert.equal((await bot.channels.edit('30', { topic: null })).topic, null);
  assert.equal((await bot.channels.startThread('30', { name: 'Thread', rate_limit_per_user: 21_600 }, { messageId: '40' })).id, '50');
  await bot.channels.addReaction('30', '40', '👍');
  assert.equal(requests.length, 0);
  assert.equal(fetch.mock.callCount(), 8);
});

test('validates forum tag fields before sending a request', async (t) => {
  const origin = 'https://micup.example';
  const sent = [];
  const fetch = t.mock.method(globalThis, 'fetch', async (url, options) => {
    const { pathname } = new URL(url);
    if (pathname === '/.well-known/fluxer') return Response.json({ endpoints: { api_public: origin + '/api' } });
    if (pathname === '/api/v1/users/@me') return Response.json({ id: '99', bot: true });
    sent.push({ path: pathname, body: JSON.parse(options.body) });
    return Response.json({ id: '30' });
  });

  const bot = await MicupClient.connect({ origin, token: 'fixture' });
  assert.throws(() => bot.channels.createForumTag('30', null), /Invalid Micup forum tag/);
  assert.throws(() => bot.channels.createForumTag('30', { name: 'x', moderated: 'yes' }), /Invalid Micup forum tag/);
  assert.throws(() => bot.channels.createForumTag('30', { name: 'x', emoji_id: 'invalid' }), /numeric string/);
  assert.throws(() => bot.channels.createForumTag('30', { name: 'x', emoji_id: '10', emoji_name: '✨' }), /Invalid Micup forum tag/);
  assert.throws(() => bot.channels.createForumTag('30', { name: 'x', emoji_name: '✨'.repeat(65) }), /Invalid Micup forum tag emoji/);
  await bot.channels.createForumTag('30', { name: 'sparkle', emoji_name: '✨', moderated: true });
  assert.deepEqual(sent, [{ path: '/api/v1/channels/30/tags', body: { name: 'sparkle', emoji_name: '✨', moderated: true } }]);
  assert.equal(fetch.mock.callCount(), 3);
});

test('validates invite options before sending a request', async (t) => {
  const origin = 'https://micup.example';
  const sent = [];
  const fetch = t.mock.method(globalThis, 'fetch', async (url, options) => {
    const { pathname } = new URL(url);
    if (pathname === '/.well-known/fluxer') return Response.json({ endpoints: { api_public: origin + '/api' } });
    if (pathname === '/api/v1/users/@me') return Response.json({ id: '99', bot: true });
    sent.push({ path: pathname, body: JSON.parse(options.body) });
    return Response.json({ code: 'fixture' });
  });

  const bot = await MicupClient.connect({ origin, token: 'fixture' });
  assert.throws(() => bot.channels.createInvite('30', null), /must be an object/);
  assert.throws(() => bot.channels.createInvite('30', { max_age: 1.5 }), /must be integers/);
  assert.throws(() => bot.channels.createInvite('30', { max_uses: Number.MAX_SAFE_INTEGER + 1 }), /must be integers/);
  assert.throws(() => bot.channels.createInvite('30', { max_age: -1 }), RangeError);
  assert.throws(() => bot.channels.createInvite('30', { max_age: 604_801 }), RangeError);
  assert.throws(() => bot.channels.createInvite('30', { max_uses: -1 }), RangeError);
  assert.throws(() => bot.channels.createInvite('30', { max_uses: 101 }), RangeError);
  assert.throws(() => bot.channels.createInvite('30', { temporary: 'yes' }), /must be booleans/);
  assert.throws(() => bot.channels.createInvite('30', { unique: 1 }), /must be booleans/);
  await bot.channels.createInvite('30', { max_age: 604_800, max_uses: 100, temporary: true, unique: false });
  assert.deepEqual(sent, [{
    path: '/api/v1/channels/30/invites', body: { max_age: 604_800, max_uses: 100, temporary: true, unique: false },
  }]);
  assert.equal(fetch.mock.callCount(), 3);
});

test('validates guild channel inputs before sending requests', async (t) => {
  const origin = 'https://micup.example';
  const sent = [];
  const fetch = t.mock.method(globalThis, 'fetch', async (url, options) => {
    const { pathname } = new URL(url);
    if (pathname === '/.well-known/fluxer') return Response.json({ endpoints: { api_public: origin + '/api' } });
    if (pathname === '/api/v1/users/@me') return Response.json({ id: '99', bot: true });
    sent.push({ method: options.method, path: pathname, body: JSON.parse(options.body) });
    return Response.json({ id: '30' });
  });

  const bot = await MicupClient.connect({ origin, token: 'fixture' });
  assert.throws(() => bot.channels.create('10', { name: 'general' }), /needs a channel type/);
  assert.throws(() => bot.channels.create('10', { name: 'general', type: 3 }), RangeError);
  assert.throws(() => bot.channels.create('10', { name: '', type: 0 }), /nonempty string/);
  assert.throws(() => bot.channels.create('10', { name: 'x'.repeat(101), type: 0 }), RangeError);
  assert.throws(() => bot.channels.edit('30', null), /must be an object/);
  assert.throws(() => bot.channels.edit('30', { parent_id: 'invalid' }), /numeric string/);
  assert.throws(() => bot.channels.edit('30', { bitrate: 7_999 }), RangeError);
  assert.throws(() => bot.channels.edit('30', { user_limit: 100 }), RangeError);
  assert.throws(() => bot.channels.edit('30', { topic: '' }), RangeError);
  assert.throws(() => bot.channels.edit('30', { permission_overwrites: [{ id: '20', type: 2, allow: '1', deny: '0' }] }), /permission overwrite/);
  assert.throws(() => bot.channels.setPermission('30', { id: '20', type: 2, allow: '1', deny: '0' }), /permission overwrite/);
  assert.throws(() => bot.channels.setPermission('30', { id: '20', type: 1, allow: '-1', deny: '0' }), /permission overwrite/);
  await bot.channels.create('10', { name: 'general', type: 0, topic: 'Chat' });
  await bot.channels.edit('30', { bitrate: 96_000, user_limit: 0, rate_limit_per_user: 21_600, nsfw: false });
  await bot.channels.setPermission('30', { id: '20', type: 1, allow: '1', deny: '0' });
  assert.deepEqual(sent, [
    { method: 'POST', path: '/api/v1/guilds/10/channels', body: { name: 'general', type: 0, topic: 'Chat' } },
    { method: 'PATCH', path: '/api/v1/channels/30', body: { bitrate: 96_000, user_limit: 0, rate_limit_per_user: 21_600, nsfw: false } },
    { method: 'PUT', path: '/api/v1/channels/30/permissions/20', body: { type: 1, allow: '1', deny: '0' } },
  ]);
  assert.equal(fetch.mock.callCount(), 5);
});

test('validates guild member updates before sending requests', async (t) => {
  const origin = 'https://micup.example';
  const sent = [];
  const fetch = t.mock.method(globalThis, 'fetch', async (url, options) => {
    const { pathname } = new URL(url);
    if (pathname === '/.well-known/fluxer') return Response.json({ endpoints: { api_public: origin + '/api' } });
    if (pathname === '/api/v1/users/@me') return Response.json({ id: '99', bot: true });
    sent.push({ path: pathname, body: JSON.parse(options.body) });
    return Response.json({ user: { id: '20' } });
  });

  const bot = await MicupClient.connect({ origin, token: 'fixture' });
  assert.throws(() => bot.guilds.editMember('10', '20', null), /must be an object/);
  assert.throws(() => bot.guilds.editMember('10', '20', { nick: 7 }), /nick must be/);
  assert.throws(() => bot.guilds.editMember('10', '20', { nick: 'x'.repeat(33) }), RangeError);
  assert.throws(() => bot.guilds.editMember('10', '20', { roles: Array(251).fill('30') }), RangeError);
  assert.throws(() => bot.guilds.editMember('10', '20', { roles: ['invalid'] }), /numeric string/);
  assert.throws(() => bot.guilds.editMember('10', '20', { roles: ['10'] }), /everyone role/);
  assert.throws(() => bot.guilds.editMember('10', '20', { mute: 'yes' }), /must be booleans/);
  assert.throws(() => bot.guilds.editMember('10', '20', { channel_id: 'invalid' }), /numeric string/);
  assert.throws(() => bot.guilds.editMember('10', '20', { connection_id: 'x'.repeat(33) }), /connection IDs/);
  assert.throws(() => bot.guilds.editMember('10', '20', { communication_disabled_until: 'tomorrow' }), /ISO 8601/);
  assert.throws(() => bot.guilds.editMember('10', '20', {
    communication_disabled_until: new Date(Date.now() + 366 * 24 * 60 * 60 * 1000).toISOString(),
  }), RangeError);
  assert.throws(() => bot.guilds.editMember('10', '20', { timeout_reason: 'x'.repeat(513) }), RangeError);
  assert.throws(() => bot.guilds.editCurrentMember('10', { accent_color: 0x1000000 }), RangeError);
  assert.throws(() => bot.guilds.editCurrentMember('10', { pronouns: 'x'.repeat(41) }), /pronouns/);
  assert.throws(() => bot.guilds.editCurrentMember('10', { avatar: 123 }), /profile images/);
  await bot.guilds.editMember('10', '20', { nick: '', roles: ['30'], mute: false, channel_id: null });
  await bot.guilds.editCurrentMember('10', { nick: null, accent_color: 0xFFFFFF, pronouns: 'they/them', avatar: null });
  assert.deepEqual(sent, [
    { path: '/api/v1/guilds/10/members/20', body: { nick: '', roles: ['30'], mute: false, channel_id: null } },
    { path: '/api/v1/guilds/10/members/@me', body: { nick: null, accent_color: 0xFFFFFF, pronouns: 'they/them', avatar: null } },
  ]);
  assert.equal(fetch.mock.callCount(), 4);
});
