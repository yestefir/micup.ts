import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Client, MessageCatalog, MicupClient, SlashCommand, localizeCommand, localizeCommands, messageCommand, userCommand } from 'micup.ts/easy';

const origin = 'https://micup.example';

async function mock(t, handler = () => Response.json({})) {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    if (String(url) === origin + '/.well-known/fluxer') return Response.json({ endpoints: { api_public: origin + '/api' } });
    if (String(url) === origin + '/api/v1/users/@me' && init.method === 'GET') return Response.json({ id: '77', username: 'robot', bot: true });
    const target = new URL(url);
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ method: init.method, path: target.pathname.replace('/api/v1', ''), body });
    return handler(target, init, body);
  });
  return calls;
}

const catalog = new MessageCatalog('en-US', {
  'en-US': {
    'play.name': 'play', 'play.description': 'Play a song', 'play.query.name': 'query', 'play.query.description': 'Song name or link',
    'play.mode.choice.loop': 'Loop', 'play.queue.add.name': 'add', 'play.queue.add.description': 'Add a song',
    'Quote.name': 'Quote', playing: 'Now playing %s', 'no-voice': 'Join a voice channel first.', 'error.generic': 'Something broke.',
  },
  tr: {
    'play.name': 'oynat', 'play.description': 'Bir şarkı çal', 'play.query.name': 'şarkı', 'play.query.description': 'Şarkı adı veya bağlantısı',
    'play.mode.choice.loop': 'Döngü', 'play.queue.add.description': 'Şarkı ekle', 'Quote.name': 'Alıntı', playing: '%s çalınıyor',
    'no-voice': 'Önce bir ses kanalına katıl.', 'error.generic': 'Bir şeyler ters gitti.',
  },
  'pt-BR': { 'play.name': 'tocar', playing: 'Tocando %s' },
});

const play = () => new SlashCommand('play', 'Play a song')
  .addString('query', 'Song name or link', { required: true })
  .addString('mode', 'Mode', { choices: [{ name: 'Loop', value: 'loop' }, 'once'] })
  .toJSON();

test('the catalog finds the best locale and reports which keys it has', () => {
  assert.equal(catalog.has('playing'), true);
  assert.equal(catalog.has('missing'), false);
  assert.equal(catalog.resolve('tr'), 'tr');
  assert.equal(catalog.resolve('TR'), 'tr');
  assert.equal(catalog.resolve('tr_TR'), 'tr');
  assert.equal(catalog.resolve('pt'), 'pt-BR');
  assert.equal(catalog.resolve('en-GB'), 'en-US');
  assert.equal(catalog.resolve('de'), undefined);
  assert.equal(catalog.resolve(''), undefined);
  assert.equal(catalog.resolve(undefined), undefined);
  assert.equal(catalog.textIn('tr_TR', 'playing', 'Ada'), 'Ada çalınıyor');
  assert.equal(catalog.textIn('de', 'playing', 'Ada'), 'Now playing Ada');
  assert.equal(catalog.textIn('pt', 'no-voice'), 'Join a voice channel first.');
  assert.equal(catalog.textIn('tr', 'unknown.key'), 'unknown.key');
  assert.equal(catalog.text({ locale: '', guild_locale: 'tr' }, 'no-voice'), 'Önce bir ses kanalına katıl.');
  assert.deepEqual(catalog.localizations('play.name'), { 'pt-BR': 'tocar', tr: 'oynat' });
  assert.deepEqual(catalog.localizations('playing'), { 'pt-BR': 'Tocando %s', tr: '%s çalınıyor' });
});

test('the catalog rejects typos, duplicates and a missing fallback', () => {
  assert.throws(() => new MessageCatalog('en', { en: { a: 'A' }, tr: { b: 'B' } }), /fallback/);
  assert.throws(() => new MessageCatalog('de', { en: { a: 'A' } }), /Fallback/);
  assert.throws(() => new MessageCatalog('en', { en: { a: 'A' }, 'not a tag': { a: 'A' } }), /locale/);
  assert.throws(() => new MessageCatalog('en', { en: { a: 'A' }, EN: { a: 'A' } }), /duplicate/i);
});

test('localizes a command, its options and its choices from catalog keys', () => {
  const original = play();
  const localized = localizeCommand(original, catalog);
  assert.equal(localized.name, 'play');
  assert.deepEqual(localized.name_localizations, { 'pt-BR': 'tocar', tr: 'oynat' });
  assert.deepEqual(localized.description_localizations, { tr: 'Bir şarkı çal' });
  const query = localized.options.find((option) => option.name === 'query');
  assert.deepEqual(query.name_localizations, { tr: 'şarkı' });
  assert.deepEqual(query.description_localizations, { tr: 'Şarkı adı veya bağlantısı' });
  const mode = localized.options.find((option) => option.name === 'mode');
  assert.equal(mode.name_localizations, undefined);
  assert.deepEqual(mode.choices[0].name_localizations, { tr: 'Döngü' });
  assert.equal(mode.choices[1].name_localizations, undefined);
  assert.equal(original.name_localizations, undefined);
  assert.equal(original.options[0].name_localizations, undefined);
});

test('rejects sparse command, option and choice arrays during localization', () => {
  assert.throws(() => localizeCommand({ name: 'sparse', options: Array(1) }, catalog), TypeError);
  assert.throws(() => localizeCommand({ name: 'sparse', options: [{ name: 'option', choices: Array(1) }] }, catalog), TypeError);
  assert.throws(() => localizeCommands(Array(1), catalog), TypeError);
});

test('localizes subcommands and groups by their dotted path', () => {
  const command = new SlashCommand('play', 'Play a song')
    .addSubcommandGroup('queue', 'Queue', (group) => group.addSubcommand('add', 'Add a song'))
    .toJSON();
  const localized = localizeCommand(command, catalog);
  const add = localized.options[0].options[0];
  assert.equal(add.name_localizations, undefined);
  assert.deepEqual(add.description_localizations, { tr: 'Şarkı ekle' });
  assert.equal(localized.options[0].name_localizations, undefined);
});

test('explicit translations win and a prefix changes the key root', () => {
  const command = { name: 'play', description: 'Play a song', name_localizations: { tr: 'cal' } };
  assert.deepEqual(localizeCommand(command, catalog).name_localizations, { 'pt-BR': 'tocar', tr: 'cal' });
  const renamed = localizeCommand({ name: 'something', description: 'x' }, catalog, { prefix: 'play' });
  assert.deepEqual(renamed.name_localizations, { 'pt-BR': 'tocar', tr: 'oynat' });
  assert.equal(localizeCommand({ name: 'other', description: 'Other' }, catalog).name_localizations, undefined);
});

test('localizes context menu names without descriptions', () => {
  const localized = localizeCommand(messageCommand('Quote'), catalog);
  assert.deepEqual(localized.name_localizations, { tr: 'Alıntı' });
  assert.equal(localized.description_localizations, undefined);
  assert.equal(localizeCommand(userCommand('Nothing'), catalog).name_localizations, undefined);
});

test('strict mode catches a default text that drifted from the catalog', () => {
  assert.doesNotThrow(() => localizeCommand(play(), catalog, { strict: true }));
  assert.throws(() => localizeCommand({ name: 'play', description: 'Plays songs' }, catalog, { strict: true }), /differs/);
  assert.equal(localizeCommands([play(), { name: 'x', description: 'x' }], catalog).length, 2);
});

test('the builder localizes itself and the output stays valid JSON for the API', () => {
  const built = new SlashCommand('play', 'Play a song').localize(catalog).addString('query', 'Song name or link', { required: true }).toJSON();
  assert.deepEqual(built.name_localizations, { 'pt-BR': 'tocar', tr: 'oynat' });
  assert.deepEqual(built.options[0].description_localizations, { tr: 'Şarkı adı veya bağlantısı' });
  assert.deepEqual(JSON.parse(JSON.stringify(built)), built);
});

test('commands validate translations with the place in the message and drop empty maps', async (t) => {
  const calls = await mock(t, () => Response.json({ id: '1', name: 'x' }));
  const bot = await MicupClient.connect({ origin, token: 'fixture' });
  await assert.rejects(async () => bot.commands.create({ name: 'play', description: 'Play', name_localizations: { 'not a tag': 'oynat' } }), /"not a tag" in the name of command "play" is not a language tag/);
  await assert.rejects(async () => bot.commands.create({ name: 'play', description: 'Play', name_localizations: { tr: 'Oynat Şarkı' } }), /Invalid translation "Oynat Şarkı" in the name of command "play" for the locale tr/);
  await assert.rejects(async () => bot.commands.create({ name: 'play', description: 'Play', description_localizations: { tr: 'x'.repeat(101) } }), /description of command "play"/);
  await assert.rejects(async () => bot.commands.create({ name: 'play', description: 'Play', options: [{ type: 3, name: 'q', description: 'Q', name_localizations: { tr: 'BÜYÜK' } }] }), /name of option "q"/);
  await assert.rejects(async () => bot.commands.create({ name: 'play', description: 'Play', options: [{ type: 3, name: 'q', description: 'Q', choices: [{ name: 'A', value: 'a', name_localizations: { tr: '' } }] }] }), /choice "A" of option "q"/);
  assert.throws(() => bot.commands.create({ name: 'play', description: 'Play', default_member_permissions: '-1' }), /unsigned 64-bit/);
  assert.throws(() => bot.commands.create({ name: 'play', description: 'Play', default_member_permissions: '18446744073709551616' }), /unsigned 64-bit/);
  assert.throws(() => bot.commands.create({ name: 'play', description: 'Play', default_member_permissions: 1 }), /unsigned 64-bit/);
  assert.throws(() => bot.commands.create(null), /definition must be an object/);
  assert.throws(() => bot.commands.create({ name: 'play', description: 'Play', id: '1' }), /definitions do not support the id field/);
  assert.throws(() => bot.commands.create({ name: 'play', description: 'Play', name_localized: 'stale response field' }), /definitions do not support the name_localized field/);
  assert.throws(() => bot.commands.create({ name: 'play', description: 'Play', options: {} }), /options must be an array/);
  assert.throws(() => bot.commands.create({ name: 'play', description: 'Play', options: [null] }), /Invalid Micup command option/);
  assert.throws(() => bot.commands.create({ name: 'play', description: 'Play', name_localizations: 42 }), /name of command "play" localizations must be an object/);
  assert.throws(() => bot.commands.create({ name: 'play', description: 'Play', description_localizations: null }), /description of command "play" localizations must be an object/);
  assert.throws(() => bot.commands.create({ name: 'play', description: 'Play', name_localizations: ['play'] }), /name of command "play" localizations must be an object/);
  assert.throws(() => bot.commands.edit('1', { name_localizations: null }), /name of command "micup" localizations must be an object/);
  assert.throws(() => bot.commands.create({ name: 123, description: 'Play' }), /Invalid Micup command name or description/);
  assert.throws(() => bot.commands.create({ name: 'play', description: 'Play', options: [{ type: 3, name: 123, description: 'Query' }] }), /Invalid or duplicate Micup command option/);
  assert.throws(() => bot.commands.edit('1', { default_member_permissions: '-1' }), /unsigned 64-bit/);
  assert.throws(() => bot.commands.edit('1', { name_localized: 'stale response field' }), /do not support the name_localized field/);
  assert.throws(() => bot.commands.edit('1', { dm_permission: 'yes' }), /must be a boolean/);
  assert.throws(() => bot.commands.edit('1', { options: [{ type: 3, name: 'Q', description: 'query' }] }), /Invalid or duplicate/);
  assert.throws(() => bot.commands.create({ name: 'play', description: 'Play', dm_permission: 'yes' }), /dm_permission must be a boolean/);
  assert.throws(() => bot.commands.create({ name: 'play', description: 'Play', options: [{ type: 3, name: 'query', description: 'Query', required: 'yes' }] }), /required must be a boolean/);
  assert.throws(() => bot.commands.create({ name: 'play', description: 'Play', options: [{ type: 3, name: 'query', description: 'Query', min_length: 5, max_length: 2 }] }), /minimum length cannot exceed/);
  assert.throws(() => bot.commands.create({ name: 'play', description: 'Play', options: [{ type: 3, name: 'query', description: 'Query', name_localized: 'old response field' }] }), /do not support the name_localized field/);
  await bot.commands.create({ name: 'plain', description: 'Plain', name_localizations: {}, description_localizations: {} });
  const body = calls.find((call) => call.method === 'POST').body;
  assert.equal('name_localizations' in body, false);
  assert.equal('description_localizations' in body, false);
  await bot.commands.create(localizeCommand(play(), catalog));
  assert.deepEqual(calls.at(-1).body.name_localizations, { 'pt-BR': 'tocar', tr: 'oynat' });
});

test('a command set refuses names that collide once translated', async (t) => {
  await mock(t, () => Response.json([]));
  const bot = await MicupClient.connect({ origin, token: 'fixture' });
  assert.throws(() => bot.commands.set([
    { name: 'play', description: 'Play', name_localizations: { tr: 'oynat' } },
    { name: 'oynat', description: 'Other' },
  ]), /Duplicate command name "oynat"/);
  await assert.doesNotReject(bot.commands.set([
    { name: 'play', description: 'Play', name_localizations: { tr: 'oynat' } },
    { name: 'play', type: 2 },
  ]));
});

async function easy(t, options = {}, handler = (url, init) => Response.json(init.method === 'GET' ? [] : { id: '9', name: 'x' })) {
  const calls = await mock(t, handler);
  const client = new Client({ token: 'fixture', origin, gateway: false, registerCommands: { guildId: '10' }, ...options });
  return { client, calls };
}

test('the easy client registers commands with their translations from the catalog', async (t) => {
  const { client, calls } = await easy(t, { catalog });
  client.command(new SlashCommand('play', 'Play a song').addString('query', 'Song name or link', { required: true }), () => {});
  await client.login();
  const create = calls.find((call) => call.method === 'POST');
  assert.deepEqual(create.body.name_localizations, { 'pt-BR': 'tocar', tr: 'oynat' });
  assert.deepEqual(create.body.description_localizations, { tr: 'Bir şarkı çal' });
  assert.deepEqual(create.body.options[0].name_localizations, { tr: 'şarkı' });
  assert.deepEqual(client.commandDefinitions[0].name_localizations, { 'pt-BR': 'tocar', tr: 'oynat' });
  assert.equal(client.catalog, catalog);
});

test('the easy client can skip localization and does not touch commands without catalog keys', async (t) => {
  const off = await easy(t, { catalog, localizeCommands: false });
  off.client.command(new SlashCommand('play', 'Play a song'), () => {});
  await off.client.login();
  assert.equal(off.calls.find((call) => call.method === 'POST').body.name_localizations, undefined);

  const plain = await easy(t, { catalog });
  plain.client.command(new SlashCommand('other', 'Other'), () => {});
  await plain.client.login();
  assert.equal(plain.calls.find((call) => call.method === 'POST').body.name_localizations, undefined);
});

test('registration compares translations and edits a command when they change', async (t) => {
  const stored = { id: '5', name: 'play', type: 1, description: 'Play a song', name_localizations: { 'pt-BR': 'tocar', tr: 'oynat' }, description_localizations: { tr: 'Bir şarkı çal' } };
  const first = await easy(t, { catalog }, (url, init) => Response.json(init.method === 'GET' ? [stored] : { id: '5', name: 'play' }));
  await first.client.login();
  first.client.command(new SlashCommand('play', 'Play a song'), () => {});
  const same = await first.client.registerCommands({ guildId: '10' });
  assert.deepEqual(same, { created: [], updated: [], unchanged: ['play'], deleted: [] });

  const changedCatalog = new MessageCatalog('en-US', { 'en-US': { 'play.name': 'play' }, tr: { 'play.name': 'çal' } });
  const second = await easy(t, { catalog: changedCatalog }, (url, init) => Response.json(init.method === 'GET' ? [stored] : { id: '5', name: 'play' }));
  await second.client.login();
  second.client.command(new SlashCommand('play', 'Play a song'), () => {});
  const changed = await second.client.registerCommands({ guildId: '10' });
  assert.deepEqual(changed.updated, ['play']);
  assert.deepEqual(second.calls.find((call) => call.method === 'PATCH').body.name_localizations, { tr: 'çal' });
});

test('interaction.t answers in the language of the user and falls back to the default', async (t) => {
  const { client, calls } = await easy(t, { catalog });
  const answers = [];
  client.command('play', (interaction) => {
    answers.push([interaction.locale, interaction.t('no-voice'), interaction.t('playing', 'Ada')]);
  });
  const send = (locale, extra = {}) => client.handleDispatch({
    name: 'INTERACTION_CREATE', sequence: 1, shardId: 0,
    data: { id: '900', application_id: '77', token: 'tok', type: 2, guild_id: '10', channel_id: '20', member: { roles: [], user: { id: '5', username: 'ada' } }, locale, data: { id: '1', name: 'play' }, ...extra },
  });
  await send('tr');
  await send('tr_TR');
  await send('pt');
  await send('de');
  await send(undefined, { guild_locale: 'tr' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(answers.map(([locale, missing, playing]) => [locale, missing, playing]), [
    ['tr', 'Önce bir ses kanalına katıl.', 'Ada çalınıyor'],
    ['tr_TR', 'Önce bir ses kanalına katıl.', 'Ada çalınıyor'],
    ['pt', 'Join a voice channel first.', 'Tocando Ada'],
    ['de', 'Join a voice channel first.', 'Now playing Ada'],
    [undefined, 'Önce bir ses kanalına katıl.', 'Ada çalınıyor'],
  ]);
  assert.equal(client.text('tr', 'playing', 'X'), 'X çalınıyor');
  assert.equal(calls.length, 0);
});

test('translations need a catalog and the generic error reply is translated', async (t) => {
  const none = await easy(t, { registerCommands: false });
  await none.client.login();
  assert.throws(() => none.client.text('tr', 'x'), /catalog/);
  const refusals = [];
  none.client.command('x', (interaction) => {
    try {
      interaction.t('x');
    } catch (error) {
      refusals.push(error.message);
    }
  });
  await none.client.handleDispatch({ name: 'INTERACTION_CREATE', sequence: 1, shardId: 0, data: { id: '900', application_id: '77', token: 'tok', type: 2, channel_id: '20', user: { id: '5', username: 'ada' }, locale: 'tr', data: { id: '1', name: 'x' } } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(refusals.length, 1);
  assert.match(refusals[0], /catalog/);

  const { client, calls } = await easy(t, { catalog, registerCommands: false });
  await client.login();
  client.on('error', () => {});
  client.command('boom', () => { throw new Error('x'); });
  await client.handleDispatch({ name: 'INTERACTION_CREATE', sequence: 1, shardId: 0, data: { id: '901', application_id: '77', token: 'tok', type: 2, channel_id: '20', user: { id: '5', username: 'ada' }, locale: 'tr', data: { id: '1', name: 'boom' } } });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(calls.find((call) => call.path.endsWith('/callback')).body.data.content, 'Bir şeyler ters gitti.');
});
