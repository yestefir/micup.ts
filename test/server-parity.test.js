import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MessageFlag, MicupAPIError, MicupClient, MicupErrorCode, Permission, background, encodeAudio, knownGatewayEvents, tokenId } from 'micup.ts';

const origin = 'https://micup.example';

async function mockBot(t, handler) {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (String(url) === origin + '/.well-known/fluxer') {
      return Response.json({ endpoints: { api_public: origin + '/api' } });
    }
    if (String(url) === origin + '/api/v1/users/@me' && options.method === 'GET') return Response.json({ id: '77', bot: true });
    const target = new URL(url);
    const body = options.body ? JSON.parse(options.body) : undefined;
    calls.push({ method: options.method, path: target.pathname.replace('/api/v1', ''), query: target.search, body, headers: options.headers });
    return handler(target, options, body);
  });
  return { bot: await MicupClient.connect({ origin, token: 'fixture' }), calls };
}

const none = () => new Response(null, { status: 204 });

test('reads and changes the custom invite URL', async (t) => {
  const { bot, calls } = await mockBot(t, (url, options) =>
    options.method === 'GET' ? Response.json({ code: 'club', uses: 4 }) : Response.json({ code: 'club-2' }));
  assert.deepEqual(await bot.guilds.vanityUrl('10'), { code: 'club', uses: 4 });
  assert.deepEqual(await bot.guilds.editVanityUrl('10', 'club-2', { reason: 'rename' }), { code: 'club-2' });
  await bot.guilds.editVanityUrl('10', null);
  assert.throws(() => bot.guilds.editVanityUrl('10', 'a'), TypeError);
  assert.throws(() => bot.guilds.editVanityUrl('10', '-bad-'), TypeError);
  assert.deepEqual(calls.map(({ method, path, body }) => [method, path, body]), [
    ['GET', '/guilds/10/vanity-url', undefined],
    ['PATCH', '/guilds/10/vanity-url', { code: 'club-2' }],
    ['PATCH', '/guilds/10/vanity-url', { code: null }],
  ]);
  assert.equal(calls[1].headers.get('X-Audit-Log-Reason'), 'rename');
});

test('manages guild soundboard sounds and plays them in a channel', async (t) => {
  const sound = { id: '5', guild_id: '10', name: 'airhorn', volume: 0.5 };
  const { bot, calls } = await mockBot(t, (url, options) => {
    if (options.method === 'GET') return Response.json({ sounds: [sound] });
    if (options.method === 'DELETE' || url.pathname.endsWith('/play')) return none();
    return Response.json(sound, { status: options.method === 'POST' ? 201 : 200 });
  });

  assert.deepEqual(await bot.sounds.list('10'), [sound]);
  await bot.sounds.create('10', { name: 'airhorn', audio: new Uint8Array([1, 2, 3]), volume: 0.5 });
  await bot.sounds.create('10', { name: 'plain', audio: 'AQID' });
  await bot.sounds.edit('10', '5', { volume: 1 });
  await bot.sounds.delete('10', '5');
  await bot.sounds.play('20', '5', { sessionId: 'session', connectionId: 'connection' });

  assert.deepEqual(calls.map(({ method, path }) => method + ' ' + path), [
    'GET /guilds/10/soundboard-sounds',
    'POST /guilds/10/soundboard-sounds',
    'POST /guilds/10/soundboard-sounds',
    'PATCH /guilds/10/soundboard-sounds/5',
    'DELETE /guilds/10/soundboard-sounds/5',
    'POST /channels/20/soundboard-sounds/5/play',
  ]);
  assert.deepEqual(calls[1].body, { name: 'airhorn', audio: 'AQID', volume: 0.5 });
  assert.deepEqual(calls[2].body, { name: 'plain', audio: 'AQID' });
  assert.deepEqual(calls[3].body, { volume: 1 });
  assert.deepEqual(calls[5].body, { session_id: 'session', connection_id: 'connection' });

  assert.throws(() => bot.sounds.edit('10', '5', {}), TypeError);
  assert.throws(() => bot.sounds.create('10', { name: '', audio: 'AQID' }), RangeError);
  assert.throws(() => bot.sounds.create('10', { name: 'loud', audio: 'AQID', volume: 2 }), RangeError);
  assert.throws(() => bot.sounds.play('20', '5', { sessionId: '', connectionId: 'c' }), TypeError);
});

test('validates audio before uploading notification sounds', async (t) => {
  const { bot, calls } = await mockBot(t, none);
  await bot.sounds.setGuildNotification('10', new Uint8Array([9, 9]));
  await bot.sounds.clearGuildNotification('10', { reason: 'reset' });
  await bot.sounds.setChannelNotification('20', 'AQID');
  await bot.sounds.clearChannelNotification('20');
  assert.deepEqual(calls.map(({ method, path }) => method + ' ' + path), [
    'PUT /guilds/10/notification-sound',
    'DELETE /guilds/10/notification-sound',
    'PUT /channels/20/notification-sound',
    'DELETE /channels/20/notification-sound',
  ]);
  assert.deepEqual(calls[0].body, { audio: 'CQk=' });

  assert.equal(encodeAudio('AQID'), 'AQID');
  assert.throws(() => encodeAudio('data:audio/mp3;base64,AQID'), TypeError);
  assert.throws(() => encodeAudio('not base64!'), TypeError);
  assert.throws(() => encodeAudio(new Uint8Array(512_001)), RangeError);
  assert.throws(() => encodeAudio(new Uint8Array(0)), TypeError);
});

test('runs a voice room stage and its effects', async (t) => {
  const stage = { v: 1, tv: null, host: { character: 'ithp-gunluk', shirt: 1 } };
  const { bot, calls } = await mockBot(t, (url, options) => {
    if (options.method === 'DELETE' || url.pathname.endsWith('/effects')) return none();
    return Response.json(options.method === 'GET' ? { stage } : stage);
  });

  assert.deepEqual(await bot.rooms.stage('20'), stage);
  await bot.rooms.setStage('20', {
    tv: { type: 'board', title: 'Skor', scores: [{ name: 'Ada', value: 3, user_id: '5' }], accent: 255 },
    host: { character: 'ithp-gunluk' },
    ttl_seconds: 120,
  });
  await bot.rooms.setStage('20', { host: { shirt: 0 } });
  await bot.rooms.stageEffect('20', { type: 'spotlight', user_id: '5' });
  await bot.rooms.stageEffect('20', { type: 'host_emote', emote: 'emoji', emoji: '🎉' });
  await bot.rooms.clearStage('20');

  assert.deepEqual(calls.map(({ method, path }) => method + ' ' + path), [
    'GET /channels/20/voice-room/stage',
    'PUT /channels/20/voice-room/stage',
    'PUT /channels/20/voice-room/stage',
    'POST /channels/20/voice-room/stage/effects',
    'POST /channels/20/voice-room/stage/effects',
    'DELETE /channels/20/voice-room/stage',
  ]);
  assert.deepEqual(calls[2].body, { tv: null, host: { shirt: 0 } });
  assert.deepEqual(calls[3].body, { type: 'spotlight', user_id: '5' });

  assert.throws(() => bot.rooms.setStage('20', { ttl_seconds: 10 }), RangeError);
  assert.throws(() => bot.rooms.setStage('20', { tv: { type: 'board', title: 'x'.repeat(61) } }), RangeError);
  assert.throws(() => bot.rooms.setStage('20', { tv: { type: 'board', text: 'a‮b' } }), RangeError);
  assert.throws(() => bot.rooms.setStage('20', { tv: { type: 'board', scores: Array(11).fill({ name: 'a', value: 1 }) } }), RangeError);
  assert.throws(() => bot.rooms.stageEffect('20', { type: 'host_emote', emote: 'emoji' }), TypeError);
  assert.throws(() => bot.rooms.stageEffect('20', { type: 'rain' }), TypeError);
});

test('opens, orders, starts and cancels a room tournament', async (t) => {
  const tournament = { v: 1, id: '9', ver: 2, game: 'slap', size: 8, status: 'registration', entrants: ['1', '2'] };
  const { bot, calls } = await mockBot(t, (url, options) => {
    if (options.method === 'DELETE') return none();
    if (options.method === 'GET') return Response.json({ tournament });
    return Response.json(tournament);
  });

  assert.deepEqual(await bot.rooms.tournament('20', { connectionId: 'conn' }), tournament);
  await bot.rooms.openTournament('20', { game: 'arm_wrestle', size: 4, table: { slot: 'T01' } });
  await bot.rooms.openTournament('20', { game: 'arm_wrestle', size: 4, table: { x: 1, z: -2, yaw: 0.5 } });
  await bot.rooms.reorderTournament('20', 2, ['2', '1']);
  await bot.rooms.startTournament('20', 2);
  await bot.rooms.cancelTournament('20');

  assert.equal(calls[0].query, '?connection_id=conn');
  assert.deepEqual(calls[1].body, { game: 'arm_wrestle', size: 4, table: { slot: 'T01' } });
  assert.deepEqual(calls[2].body.table, { x: 1, z: -2, yaw: 0.5 });
  assert.deepEqual(calls[3].body, { version: 2, user_ids: ['2', '1'] });
  assert.deepEqual(calls[4].body, { version: 2 });
  assert.equal(calls[5].method, 'DELETE');

  assert.throws(() => bot.rooms.openTournament('20', { game: 'chess', size: 4 }), TypeError);
  assert.throws(() => bot.rooms.openTournament('20', { game: 'slap', size: 5 }), RangeError);
  assert.throws(() => bot.rooms.openTournament('20', { game: 'arm_wrestle', size: 4, table: { slot: 'T1', x: 1 } }), TypeError);
  assert.throws(() => bot.rooms.openTournament('20', { game: 'arm_wrestle', size: 4, table: { x: 500, z: 0, yaw: 0 } }), RangeError);
  assert.throws(() => bot.rooms.reorderTournament('20', 2, ['1', '1']), RangeError);
});

test('covers member, ownership and message clean-up routes', async (t) => {
  const { bot, calls } = await mockBot(t, (url, options) => {
    if (url.pathname.endsWith('/members/search')) return Response.json([{ user: { id: '3' } }]);
    if (url.pathname.endsWith('/members/@me')) return Response.json({ nick: 'Yeni' });
    if (url.pathname.endsWith('/transfer-ownership')) return Response.json({ id: '10', owner_id: '3' });
    if (url.pathname.endsWith('/crosspost-source')) return Response.json({ guild: { id: '11', name: 'Kaynak' } });
    if (url.pathname.endsWith('/roles/6')) return Response.json({ id: '6' });
    if (url.pathname.endsWith('/bans/3')) return Response.json({ user: { id: '3' }, reason: null });
    return new Response(null, { status: options.method === 'POST' ? 202 : 204 });
  });

  assert.equal((await bot.guilds.findMembers('10', 'Ad', { limit: 5 }))[0].user.id, '3');
  assert.equal((await bot.guilds.setNickname('10', 'Yeni')).nick, 'Yeni');
  await bot.guilds.editCurrentMember('10', { bio: 'merhaba', mute: false });
  assert.equal((await bot.guilds.transferOwnership('10', '3', { reason: 'devir' })).owner_id, '3');
  await bot.guilds.deleteOwnMessages('10', { password: 'secret' });
  await bot.channels.deleteOwnMessages('20', { mfa_method: 'totp', mfa_code: '123456' });
  assert.equal((await bot.channels.crosspostSource('20', '30')).guild.name, 'Kaynak');
  assert.equal((await bot.guilds.role('10', '6')).id, '6');
  assert.equal((await bot.guilds.getBan('10', '3')).user.id, '3');
  await bot.channels.addRecipient('20', '3');
  await bot.channels.removeRecipient('20', '3', { silent: true });

  assert.deepEqual(calls.map(({ method, path, query }) => method + ' ' + path + query), [
    'GET /guilds/10/members/search?query=Ad&limit=5',
    'PATCH /guilds/10/members/@me',
    'PATCH /guilds/10/members/@me',
    'POST /guilds/10/transfer-ownership',
    'POST /users/@me/guilds/10/messages/bulk-delete-mine',
    'POST /channels/20/messages/bulk-delete-mine',
    'GET /channels/20/messages/30/crosspost-source',
    'GET /guilds/10/roles/6',
    'GET /guilds/10/bans/3',
    'PUT /channels/20/recipients/3',
    'DELETE /channels/20/recipients/3?silent=true',
  ]);
  assert.deepEqual(calls[1].body, { nick: 'Yeni' });
  assert.deepEqual(calls[3].body, { new_owner_id: '3' });
  assert.deepEqual(calls[4].body, { password: 'secret' });
  assert.deepEqual(calls[5].body, { mfa_method: 'totp', mfa_code: '123456' });

  assert.throws(() => bot.guilds.findMembers('10', 'x', { limit: 0 }), RangeError);
  assert.throws(() => bot.guilds.setNickname('10', ''), RangeError);
});

test('moves channels, clears commands and edits the bot profile', async (t) => {
  const { bot, calls } = await mockBot(t, (url, options) =>
    url.pathname === '/api/v1/users/@me' ? Response.json({ id: '77', username: 'yeni' }) : none());

  await bot.guilds.moveChannels('10', [{ id: '1', parent_id: null, position: 0 }, { id: '2', preceding_sibling_id: '1', lock_permissions: true }]);
  await bot.commands.clear();
  await bot.commands.clear({ guildId: '10' });
  assert.equal((await bot.users.editCurrentUser({ username: 'yeni', avatar: null })).username, 'yeni');
  await bot.channels.archiveThread('44');
  await bot.channels.lockThread('44', false);

  assert.deepEqual(calls.map(({ method, path }) => method + ' ' + path), [
    'PATCH /guilds/10/channels',
    'DELETE /applications/77/commands',
    'DELETE /applications/77/guilds/10/commands',
    'PATCH /users/@me',
    'PATCH /channels/44',
    'PATCH /channels/44',
  ]);
  assert.deepEqual(calls[0].body, [
    { position: 0, id: '1', parent_id: null },
    { lock_permissions: true, id: '2', preceding_sibling_id: '1' },
  ]);
  assert.deepEqual(calls[3].body, { username: 'yeni', avatar: null });
  assert.deepEqual(calls[4].body, { archived: true });
  assert.deepEqual(calls[5].body, { locked: false });

  assert.throws(() => bot.guilds.moveChannels('10', []), RangeError);
  assert.throws(() => bot.users.editCurrentUser({ username: 'bad name' }), TypeError);
});

test('reads emoji, sticker and public application records', async (t) => {
  const { bot, calls } = await mockBot(t, (url) =>
    url.pathname.endsWith('/public') ? Response.json({ id: '8', name: 'Bot' }) : Response.json({ id: '1', name: 'x', features: [] }));

  await bot.expressions.emoji('10', '1');
  await bot.expressions.sticker('10', '2');
  await bot.expressions.source('emojis', '1');
  await bot.expressions.source('stickers', '2');
  assert.equal((await bot.users.publicApplication('8')).name, 'Bot');

  assert.deepEqual(calls.map(({ method, path }) => method + ' ' + path), [
    'GET /guilds/10/emojis/1',
    'GET /guilds/10/stickers/2',
    'GET /emojis/1/source',
    'GET /stickers/2/source',
    'GET /oauth2/applications/8/public',
  ]);
  assert.equal(calls[4].headers.get('Authorization'), null);
  assert.equal(calls[0].headers.get('Authorization'), 'Bot fixture');
});

test('exposes error codes, status helpers and new Gateway events', () => {
  const response = new Response(null, { status: 429 });
  const error = new MicupAPIError(response, { code: MicupErrorCode.NewDMRateLimited, errors: [{ path: 'x', code: 'TOO_FAST', message: 'm' }] });
  assert.equal(error.rateLimited, true);
  assert.equal(error.notFound, false);
  assert.equal(error.forbidden, false);
  assert.equal(error.hasFieldCode('TOO_FAST'), true);
  assert.equal(error.hasFieldCode('OTHER'), false);
  assert.equal(error.code, 'NEW_DM_RATE_LIMITED');
  assert.equal(MicupErrorCode.SpamBlocked, 'SPAM_BLOCKED');

  assert.ok(knownGatewayEvents.includes('GUILD_SOUNDBOARD_SOUNDS_UPDATE'));
  assert.ok(knownGatewayEvents.includes('GUILD_SOUNDBOARD_SOUND_PLAY'));
  assert.equal(Permission.ManageRoomStage, 1n << 62n);
  assert.ok((Permission.All & Permission.ManageRoomStage) === Permission.ManageRoomStage);
});

test('reads the bot id from both token layouts', () => {
  const encode = (text) => Buffer.from(text).toString('base64').replace(/=+$/, '');
  assert.equal(tokenId(encode('1234567890123456') + '.' + encode('1700000000') + '.secret'), '1234567890123456');
  assert.equal(tokenId('1234567890123456.secret'), '1234567890123456');
  assert.equal(tokenId(encode('99') + '.secret'), '99');
  assert.equal(tokenId('nodots'), undefined);
  assert.equal(tokenId('.secret'), undefined);
  assert.equal(tokenId('abc!.secret'), undefined);
  assert.equal(tokenId(encode('12ab') + '.secret'), undefined);
});

test('caches the bot identity and the application record', async (t) => {
  let applications = 0;
  const { bot } = await mockBot(t, (url) => {
    if (url.pathname.endsWith('/applications/@me')) {
      applications++;
      return Response.json({ id: '77', name: 'Bot' });
    }
    return none();
  });
  assert.equal(bot.self.id, '77');
  assert.equal(bot.tokenId, undefined);
  assert.equal((await bot.application()).name, 'Bot');
  assert.equal(await bot.applicationId(), '77');
  assert.equal(applications, 1);
});

test('toggles embed suppression without disturbing other flags', async (t) => {
  const { bot, calls } = await mockBot(t, (url, options) =>
    Response.json(options.method === 'GET' ? { id: '30', flags: MessageFlag.SuppressNotifications | MessageFlag.HasThread | MessageFlag.SuppressEmbeds } : { id: '30' }));
  await bot.suppressEmbeds('20', '30', false);
  await bot.suppressEmbeds('20', '30');
  assert.deepEqual(calls.filter(({ method }) => method === 'PATCH').map(({ body }) => body.flags), [
    MessageFlag.SuppressNotifications,
    MessageFlag.SuppressNotifications | MessageFlag.SuppressEmbeds,
  ]);
});

test('warns once a minute when the bot lacks a permission', async (t) => {
  const warnings = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (String(url) === origin + '/.well-known/fluxer') return Response.json({ endpoints: { api_public: origin + '/api' } });
    if (String(url) === origin + '/api/v1/users/@me') return Response.json({ id: '77', bot: true });
    return Response.json({ code: 'MISSING_PERMISSIONS', message: 'Missing Permissions' }, { status: 403 });
  });
  const bot = await MicupClient.connect({ origin, token: 'fixture', logger: { warn: (message, fields) => warnings.push({ message, fields }) } });
  await assert.rejects(bot.guilds.kick('10', '5'), (error) => error.forbidden);
  await assert.rejects(bot.guilds.kick('10', '5'));
  await assert.rejects(bot.guilds.kick('10', '6'));
  assert.equal(warnings.length, 2);
  assert.deepEqual(warnings[0].fields, {
    method: 'DELETE', path: '/guilds/10/members/5', code: 'MISSING_PERMISSIONS', guild: '10', message: 'Missing Permissions',
  });
});

test('masks webhook and interaction tokens in permission logs', async (t) => {
  const warnings = [];
  t.mock.method(globalThis, 'fetch', async (url) => {
    if (String(url) === origin + '/.well-known/fluxer') return Response.json({ endpoints: { api_public: origin + '/api' } });
    if (String(url) === origin + '/api/v1/users/@me') return Response.json({ id: '77', bot: true });
    return Response.json({ code: 'MISSING_ACCESS', message: 'Missing Access' }, { status: 403 });
  });
  const bot = await MicupClient.connect({
    origin,
    token: 'fixture',
    logger: { warn: (message, fields) => warnings.push({ message, fields }) },
  });

  await assert.rejects(bot.webhooks.execute('60', 'webhook-secret', 'hello'));
  await assert.rejects(bot.interactions.respond({ id: '70', token: 'interaction-secret' }, 'hello'));
  assert.deepEqual(warnings.map(({ fields }) => fields.path), [
    '/webhooks/60/{token}',
    '/interactions/70/{token}/callback',
  ]);
  assert.equal(JSON.stringify(warnings).includes('webhook-secret'), false);
  assert.equal(JSON.stringify(warnings).includes('interaction-secret'), false);
});

test('runs background work without blocking or crashing the caller', async () => {
  const errors = [];
  let ran = false;
  const pending = background(async () => { ran = true; throw new Error('boom'); }, { name: 'search', onError: (error, name) => errors.push([error.message, name]) });
  assert.equal(ran, false);
  await pending;
  assert.deepEqual(errors, [['boom', 'search']]);

  let aborted = false;
  await background((signal) => new Promise((resolve) => signal.addEventListener('abort', () => { aborted = true; resolve(); })), { timeoutMs: 5 });
  assert.equal(aborted, true);

  const controller = new AbortController();
  const silent = [];
  const stopped = background(() => { controller.abort(); throw new Error('late'); }, { signal: controller.signal, onError: (error) => silent.push(error) });
  await stopped;
  assert.deepEqual(silent, []);
  assert.throws(() => background(() => {}, { timeoutMs: 0 }), RangeError);
});

test('iterates members, audit log entries, pins and thread members page by page', async (t) => {
  const members = (from, count) => Array.from({ length: count }, (_, index) => ({ user: { id: String(from + index) } }));
  const entries = (from, count) => Array.from({ length: count }, (_, index) => ({ id: String(from - index), action_type: 1 }));
  const { bot, calls } = await mockBot(t, (url) => {
    const after = url.searchParams.get('after');
    const before = url.searchParams.get('before');
    if (url.pathname === '/api/v1/guilds/10/members') return Response.json(after === null ? members(1, 1000) : members(1001, 3));
    if (url.pathname === '/api/v1/guilds/10/audit-logs') {
      return Response.json({ audit_log_entries: before === null ? entries(300, 100) : entries(200, 40) });
    }
    if (url.pathname === '/api/v1/channels/20/messages/pins') {
      return before === null
        ? Response.json({ items: [{ message: { id: '1' }, pinned_at: '2026-01-02' }, { message: { id: '2' }, pinned_at: '2026-01-01' }], has_more: true })
        : Response.json({ items: [{ message: { id: '2' }, pinned_at: '2026-01-01' }], has_more: true });
    }
    return Response.json(after === null
      ? Array.from({ length: 100 }, (_, index) => ({ user_id: String(index + 1) }))
      : [{ user_id: '101' }]);
  });

  const collected = { members: [], entries: [], pins: [], threadMembers: [] };
  for await (const member of bot.guilds.iterateMembers('10')) collected.members.push(member.user.id);
  for await (const entry of bot.guilds.iterateAuditLog('10', { actionType: 1 })) collected.entries.push(entry.id);
  for await (const pin of bot.channels.iteratePins('20')) collected.pins.push(pin.message.id);
  for await (const member of bot.channels.iterateThreadMembers('30', { withMember: true })) collected.threadMembers.push(member.user_id);

  assert.equal(collected.members.length, 1003);
  assert.equal(collected.members.at(-1), '1003');
  assert.equal(collected.entries.length, 140);
  assert.deepEqual(collected.pins, ['1', '2']);
  assert.equal(collected.threadMembers.length, 101);
  assert.equal(calls.find(({ path, query }) => path === '/guilds/10/members' && query.includes('after')).query, '?limit=1000&after=1000');
  assert.ok(calls.some(({ path, query }) => path === '/guilds/10/audit-logs' && query.includes('before=201') && query.includes('action_type=1')));
  assert.ok(calls.some(({ path, query }) => path === '/channels/30/thread-members' && query === '?limit=100&with_member=true&after=100'));
});

test('manages a guild discovery listing', async (t) => {
  const application = { guild_id: '10', status: 'pending', description: 'A place to talk.', category_type: 4 };
  const { bot, calls } = await mockBot(t, (url, options) => {
    if (options.method === 'DELETE') return none();
    return Response.json(options.method === 'GET' ? { application, eligible: true, min_member_count: 50 } : application);
  });
  assert.equal((await bot.discovery.status('10')).min_member_count, 50);
  await bot.discovery.apply('10', { description: 'A place to talk.', category_type: 4, custom_tags: ['rust'] });
  await bot.discovery.edit('10', { custom_tags: [] });
  await bot.discovery.withdraw('10');
  assert.deepEqual(calls.map(({ method, path }) => method + ' ' + path), [
    'GET /guilds/10/discovery', 'POST /guilds/10/discovery', 'PATCH /guilds/10/discovery', 'DELETE /guilds/10/discovery',
  ]);
  assert.throws(() => bot.discovery.apply('10', { description: 'short', category_type: 4 }), RangeError);
  assert.throws(() => bot.discovery.apply('10', { description: 'A place to talk.' }), TypeError);
  assert.throws(() => bot.discovery.edit('10', { custom_tags: Array(11).fill('x') }), RangeError);
});
