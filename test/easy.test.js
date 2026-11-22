import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  Client, CommandInteraction, ComponentInteraction, InteractionRepliedError, MessageCatalog, ModalSubmitInteraction, Permission, paginate,
  SlashCommand, messageCommand, modal, primaryButton, shortInput, userCommand,
} from 'micup.ts/easy';

const origin = 'https://micup.example';

async function setup(t, handler = () => Response.json({}), options = {}) {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    if (String(url) === origin + '/.well-known/fluxer') return Response.json({ endpoints: { api_public: origin + '/api' } });
    if (String(url) === origin + '/api/v1/users/@me' && init.method === 'GET') return Response.json({ id: '77', username: 'robot', bot: true });
    const target = new URL(url);
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ method: init.method, path: target.pathname.replace('/api/v1', ''), query: target.search, body });
    return handler(target, init, body, calls);
  });
  const client = new Client({ token: 'fixture', origin, gateway: false, ...options });
  await client.login();
  return { client, calls };
}

let sequence = 0;
const dispatch = (client, name, data) => client.handleDispatch({ name, data, sequence: ++sequence, shardId: 0 });
const settle = () => new Promise((resolve) => setImmediate(resolve));

const author = { id: '5', username: 'ada', global_name: 'Ada' };
const base = { id: '900', application_id: '77', token: 'tok', guild_id: '10', channel_id: '20', member: { roles: [], user: author }, locale: 'tr' };
const commandData = (name, options) => ({ id: '300', name, options });

test('login needs a token and exposes the bot user without a Gateway', async (t) => {
  await assert.rejects(new Client({ origin }).login(), /token is required/);
  const { client } = await setup(t);
  assert.equal(client.ready, true);
  assert.equal(client.user.id, '77');
  assert.equal(client.user.displayName, 'robot');
  assert.throws(() => new Client().rest, /login/);
  assert.throws(() => client.setStatus('idle'), /Gateway/);
  await assert.rejects(client.login(), /already/);
});

test('destroy aborts REST discovery while login is still starting', async (t) => {
  let signal;
  let markStarted;
  const started = new Promise((resolve) => { markStarted = resolve; });
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    signal = options.signal;
    markStarted();
    return new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    });
  });
  const client = new Client({ token: 'fixture', origin, gateway: false });
  let ready = false;
  client.on('ready', () => { ready = true; });
  const login = client.login();
  await started;
  await client.destroy();

  await assert.rejects(login, (error) => error === signal.reason);
  assert.equal(signal.aborted, true);
  assert.equal(ready, false);
});

test('destroy aborts command registration before the ready event', async (t) => {
  let signal;
  let markStarted;
  const started = new Promise((resolve) => { markStarted = resolve; });
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (String(url) === origin + '/.well-known/fluxer') return Response.json({ endpoints: { api_public: origin + '/api' } });
    if (String(url) === origin + '/api/v1/users/@me') return Response.json({ id: '77', username: 'robot', bot: true });
    if (new URL(url).pathname === '/api/v1/applications/77/commands') {
      signal = options.signal;
      markStarted();
      return new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    }
    assert.fail('Unexpected request ' + String(url));
  });
  const client = new Client({ token: 'fixture', origin, gateway: false });
  client.command(new SlashCommand('fixture', 'Fixture'), () => {});
  let ready = false;
  client.on('ready', () => { ready = true; });
  const login = client.login();
  await started;
  await client.destroy();

  await assert.rejects(login, (error) => error === signal.reason);
  assert.equal(signal.aborted, true);
  assert.equal(ready, false);
});

test('ignores malformed readiness fields without replacing the bot identity', async (t) => {
  const { client } = await setup(t, undefined, { sequential: true });
  await dispatch(client, 'READY', { guilds: {}, user: 'invalid' });
  await dispatch(client, 'GUILD_CREATE', null);
  assert.equal(client.user.id, '77');
});

test('wraps messages and replies, reacts, edits and deletes through the REST client', async (t) => {
  const { client, calls } = await setup(t, (url, init) => Response.json(init.method === 'GET' ? {} : { id: '901', channel_id: '20', content: 'sent', author: { id: '77', username: 'robot', bot: true } }));
  const seen = [];
  client.on('messageCreate', async (message) => {
    seen.push([message.id, message.content, message.author.tag, message.author.mention, message.fromSelf, message.inGuild(), message.channel.id]);
    const reply = await message.reply('pong');
    assert.equal(reply.fromSelf, true);
    await message.react('<:party:123456>');
    await message.react('👍');
    await message.edit('changed');
    await message.pin();
    await message.delete({ reason: 'cleanup' });
  });
  await dispatch(client, 'MESSAGE_CREATE', { id: '800', channel_id: '20', guild_id: '10', content: '!ping', author });
  await settle();
  await settle();
  assert.deepEqual(seen, [['800', '!ping', 'ada', '<@5>', false, true, '20']]);
  const reply = calls.find((call) => call.method === 'POST' && call.path === '/channels/20/messages');
  assert.deepEqual(reply.body, { content: 'pong', message_reference: { message_id: '800', channel_id: '20' } });
  const paths = calls.map((call) => call.method + ' ' + call.path);
  assert.ok(paths.includes('PUT /channels/20/messages/800/reactions/party%3A123456/@me'));
  assert.ok(paths.some((entry) => entry.startsWith('PUT /channels/20/messages/800/reactions/') && entry.includes('%F0%9F%91%8D')));
  assert.ok(paths.includes('PATCH /channels/20/messages/800'));
  assert.ok(paths.includes('PUT /channels/20/pins/800'));
  assert.ok(paths.includes('DELETE /channels/20/messages/800'));
});

test('delivers raw Gateway events by name and friendly events with wrappers', async (t) => {
  const { client } = await setup(t);
  const seen = [];
  client.on('GUILD_BAN_ADD', (data, event) => seen.push(['raw', data.guild_id, event.name]));
  client.on('guildBanAdd', ({ guildId, user }) => seen.push(['ban', guildId, user.tag]));
  client.on('guildMemberAdd', (member) => seen.push(['join', member.guildId, member.user.username, member.id]));
  client.on('guildMemberRemove', ({ guildId, user }) => seen.push(['leave', guildId, user.id]));
  client.on('messageDelete', (event) => seen.push(['delete', event.id, event.channelId]));
  client.on('messageUpdate', (update) => seen.push(['update', update.id, update.content, update.message === null]));
  client.on('messageReactionAdd', (reaction) => seen.push(['reaction', reaction.userId, reaction.emoji.name, reaction.channel.id]));
  client.on('channelCreate', (channel) => seen.push(['channel', channel.id, channel.isText(), channel.mention]));
  client.on('raw', (event) => seen.push(['all', event.name]));
  await dispatch(client, 'GUILD_BAN_ADD', { guild_id: '10', user: author });
  await dispatch(client, 'GUILD_MEMBER_ADD', { guild_id: '10', roles: [], user: author });
  await dispatch(client, 'GUILD_MEMBER_REMOVE', { guild_id: '10', user: author });
  await dispatch(client, 'MESSAGE_DELETE', { id: '1', channel_id: '20' });
  await dispatch(client, 'MESSAGE_UPDATE', { id: '2', channel_id: '20', content: 'edited' });
  await dispatch(client, 'MESSAGE_REACTION_ADD', { user_id: '5', channel_id: '20', message_id: '2', emoji: { name: '🔥' } });
  await dispatch(client, 'CHANNEL_CREATE', { id: '21', type: 0, guild_id: '10' });
  await settle();
  assert.deepEqual(seen.filter(([kind]) => kind !== 'all'), [
    ['raw', '10', 'GUILD_BAN_ADD'], ['ban', '10', 'ada'], ['join', '10', 'ada', '5'], ['leave', '10', '5'], ['delete', '1', '20'],
    ['update', '2', 'edited', true], ['reaction', '5', '🔥', '20'], ['channel', '21', true, '<#21>'],
  ]);
  assert.equal(seen.filter(([kind]) => kind === 'all').length, 7);
});

test('reports listener and handler errors without crashing or replaying the event', async (t) => {
  const { client } = await setup(t);
  const reported = [];
  client.on('error', (error, context) => reported.push([error.message, context.event]));
  client.on('messageCreate', () => { throw new Error('sync failure'); });
  client.on('messageCreate', async () => { throw new Error('async failure'); });
  await dispatch(client, 'MESSAGE_CREATE', { id: '1', channel_id: '20', content: 'x', author });
  await settle();
  assert.deepEqual(reported.map(([message]) => message).sort(), ['async failure', 'sync failure']);
  assert.ok(reported.every(([, event]) => event === 'MESSAGE_CREATE'));

  const quiet = (await setup(t)).client;
  const logged = [];
  t.mock.method(console, 'error', (...args) => logged.push(args.map(String).join(' ')));
  quiet.on('messageCreate', () => { throw new Error('no error listener'); });
  await dispatch(quiet, 'MESSAGE_CREATE', { id: '1', channel_id: '20', content: 'x', author });
  await settle();
  assert.ok(logged.some((line) => line.includes('no error listener')));
});

test('supports once and off', async (t) => {
  const { client } = await setup(t);
  const seen = [];
  const listener = () => seen.push('on');
  client.on('messageCreate', listener);
  client.once('messageCreate', () => seen.push('once'));
  await dispatch(client, 'MESSAGE_CREATE', { id: '1', channel_id: '20', content: 'x', author });
  await dispatch(client, 'MESSAGE_CREATE', { id: '2', channel_id: '20', content: 'x', author });
  await settle();
  client.off('messageCreate', listener);
  await dispatch(client, 'MESSAGE_CREATE', { id: '3', channel_id: '20', content: 'x', author });
  await settle();
  assert.deepEqual(seen, ['on', 'once', 'on']);
});

test('routes slash commands by path, reads options and tracks replies', async (t) => {
  const { client, calls } = await setup(t, (url) => Response.json(url.pathname.includes('/webhooks/') ? { id: '950', channel_id: '20', content: 'x', author: { id: '77', username: 'robot' } } : {}));
  const handled = [];
  client.command('tool echo', async (interaction) => {
    assert.ok(interaction instanceof CommandInteraction);
    handled.push(['echo', interaction.commandName, interaction.subcommand, interaction.path, interaction.options.getString('text', true), interaction.options.getInteger('count'), interaction.options.getBoolean('loud'), interaction.user.id, interaction.member.guildId]);
    assert.equal(interaction.replied, false);
    await interaction.reply({ content: 'echo', ephemeral: true });
    assert.equal(interaction.replied, true);
    await assert.rejects(interaction.reply('again'), InteractionRepliedError);
    await assert.rejects(interaction.deferReply(), InteractionRepliedError);
    await interaction.editReply('edited');
    const followUp = await interaction.followUp({ content: 'more', ephemeral: true });
    assert.equal(followUp.id, '950');
    await interaction.deleteReply();
  });
  client.command('tool', () => handled.push('fallback'));
  await dispatch(client, 'INTERACTION_CREATE', {
    ...base, type: 2,
    data: commandData('tool', [{ type: 1, name: 'echo', options: [{ type: 3, name: 'text', value: 'hi' }, { type: 4, name: 'count', value: 3 }, { type: 5, name: 'loud', value: true }] }]),
  });
  await settle();
  await settle();
  assert.deepEqual(handled, [['echo', 'tool', 'echo', 'tool echo', 'hi', 3, true, '5', '10']]);
  const callback = calls.find((call) => call.path === '/interactions/900/tok/callback');
  assert.deepEqual(callback.body, { type: 4, data: { content: 'echo', flags: 64 } });
  assert.ok(calls.some((call) => call.method === 'PATCH' && call.path === '/webhooks/77/tok/messages/@original'));
  assert.ok(calls.some((call) => call.method === 'POST' && call.path === '/webhooks/77/tok'));
  assert.ok(calls.some((call) => call.method === 'DELETE' && call.path === '/webhooks/77/tok/messages/@original'));

  handled.length = 0;
  await dispatch(client, 'INTERACTION_CREATE', { ...base, id: '901', type: 2, data: commandData('tool', [{ type: 1, name: 'other' }]) });
  await settle();
  assert.deepEqual(handled, ['fallback']);
});

test('refuses to edit or follow up before the interaction is answered and supports deferral', async (t) => {
  const { client, calls } = await setup(t);
  const results = [];
  client.command('slow', async (interaction) => {
    await assert.rejects(interaction.editReply('x'), InteractionRepliedError);
    await assert.rejects(interaction.followUp('x'), InteractionRepliedError);
    await interaction.deferReply({ ephemeral: true });
    results.push([interaction.deferred, interaction.replied]);
    await assert.rejects(interaction.reply('x'), InteractionRepliedError);
  });
  await dispatch(client, 'INTERACTION_CREATE', { ...base, type: 2, data: commandData('slow') });
  await settle();
  await settle();
  assert.deepEqual(results, [[true, false]]);
  assert.deepEqual(calls.find((call) => call.path.endsWith('/callback')).body, { type: 5, data: { flags: 64 } });
});

test('resolves users, members, roles, channels and attachments from command options', async (t) => {
  const { client } = await setup(t);
  const seen = [];
  client.command('inspect', (interaction) => {
    const o = interaction.options;
    seen.push([o.getUser('who').username, o.getMember('who').nick, o.getMember('who').guildId, o.getRole('role').id, o.getChannel('where').id, o.getAttachment('file').filename, o.getString('missing'), o.has('who')]);
    assert.throws(() => o.getString('missing', true), /required/);
    assert.equal(interaction.targetUser, null);
  });
  await dispatch(client, 'INTERACTION_CREATE', {
    ...base, type: 2,
    data: {
      ...commandData('inspect', [
        { type: 6, name: 'who', value: '5' }, { type: 8, name: 'role', value: '9' }, { type: 7, name: 'where', value: '7' }, { type: 11, name: 'file', value: '3' },
      ]),
      resolved: {
        users: { 5: author }, members: { 5: { roles: [], nick: 'Adaa' } }, roles: { 9: { id: '9', name: 'r', position: 1, permissions: '0' } },
        channels: { 7: { id: '7', type: 0 } }, attachments: { 3: { id: '3', filename: 'a.txt', url: 'https://x' } },
      },
    },
  });
  await settle();
  assert.deepEqual(seen, [['ada', 'Adaa', '10', '9', '7', 'a.txt', null, true]]);
});

test('routes context menu commands with their targets', async (t) => {
  const { client } = await setup(t);
  const seen = [];
  client.command(userCommand('Inspect user'), (interaction) => seen.push(['user', interaction.isUserContextMenu(), interaction.targetUser.id]));
  client.command(messageCommand('Quote'), (interaction) => seen.push(['message', interaction.isMessageContextMenu(), interaction.targetMessage.content]));
  await dispatch(client, 'INTERACTION_CREATE', { ...base, type: 2, data: { id: '1', name: 'Inspect user', type: 2, target_id: '5', resolved: { users: { 5: author } } } });
  await dispatch(client, 'INTERACTION_CREATE', { ...base, id: '902', type: 2, data: { id: '2', name: 'Quote', type: 3, target_id: '4', resolved: { messages: { 4: { id: '4', channel_id: '20', content: 'quoted', author } } } } });
  await settle();
  assert.deepEqual(seen, [['user', true, '5'], ['message', true, 'quoted']]);
  assert.deepEqual(client.commandDefinitions.map((definition) => [definition.name, definition.type]), [['Inspect user', 2], ['Quote', 3]]);
});

test('routes components by exact id, prefix and pattern and updates the message', async (t) => {
  const { client, calls } = await setup(t);
  const seen = [];
  client.component('confirm', async (interaction) => {
    assert.ok(interaction instanceof ComponentInteraction);
    seen.push(['confirm', interaction.isButton(), interaction.isSelectMenu(), interaction.message.id]);
    await interaction.update({ content: 'done', components: [] });
    await assert.rejects(interaction.update('again'), InteractionRepliedError);
  });
  client.component('vote:*', async (interaction) => {
    seen.push(['vote', interaction.customId.split(':')[1]]);
    await interaction.deferUpdate();
    assert.equal(interaction.deferred, true);
  });
  client.component(/^menu-\d+$/, async (interaction) => {
    seen.push(['menu', interaction.isSelectMenu(), interaction.values, interaction.users.map((user) => user.id), interaction.members.map((member) => member.nick), interaction.roles.length]);
    await interaction.showModal(modal('feedback', 'Feedback', shortInput('subject', 'Subject')));
  });
  const message = { id: '555', channel_id: '20', content: 'panel', author: { id: '77', username: 'robot', bot: true } };
  await dispatch(client, 'INTERACTION_CREATE', { ...base, type: 3, message, data: { custom_id: 'confirm', component_type: 2 } });
  await dispatch(client, 'INTERACTION_CREATE', { ...base, id: '901', type: 3, message, data: { custom_id: 'vote:yes', component_type: 2 } });
  await dispatch(client, 'INTERACTION_CREATE', {
    ...base, id: '902', type: 3, message,
    data: { custom_id: 'menu-7', component_type: 5, values: ['5'], resolved: { users: { 5: author }, members: { 5: { roles: [], nick: 'Adaa' } } } },
  });
  await settle();
  await settle();
  assert.deepEqual(seen, [['confirm', true, false, '555'], ['vote', 'yes'], ['menu', true, ['5'], ['5'], ['Adaa'], 0]]);
  const types = calls.filter((call) => call.path.endsWith('/callback')).map((call) => call.body.type);
  assert.deepEqual(types, [7, 6, 9]);
  const modalCall = calls.find((call) => call.body?.type === 9);
  assert.equal(modalCall.body.data.custom_id, 'feedback');
});

test('routes modal submits and reads their fields', async (t) => {
  const { client } = await setup(t);
  const seen = [];
  client.modal('feedback', (interaction) => {
    assert.ok(interaction instanceof ModalSubmitInteraction);
    seen.push([interaction.customId, interaction.fields.getTextInputValue('subject'), interaction.fields.getTextInputValue('none'), interaction.fields.all]);
    assert.throws(() => interaction.fields.getTextInputValue('none', true), /missing/);
  });
  await dispatch(client, 'INTERACTION_CREATE', {
    ...base, type: 5, data: { custom_id: 'feedback', components: [{ type: 1, components: [{ type: 4, custom_id: 'subject', value: 'Hello' }] }] },
  });
  await settle();
  assert.deepEqual(seen, [['feedback', 'Hello', null, { subject: 'Hello' }]]);
});

test('answers autocomplete requests and refuses regular replies', async (t) => {
  const { client, calls } = await setup(t);
  client.autocomplete('tool pick', async (interaction) => {
    assert.equal(interaction.focused.name, 'fruit');
    assert.equal(interaction.focused.value, 'ap');
    await assert.rejects(interaction.reply('x'), InteractionRepliedError);
    await assert.rejects(interaction.deferReply(), InteractionRepliedError);
    await interaction.respond(['apple', { name: 'Apricot', value: 'apricot' }, 3]);
  });
  await dispatch(client, 'INTERACTION_CREATE', {
    ...base, type: 4,
    data: commandData('tool', [{ type: 1, name: 'pick', options: [{ type: 3, name: 'fruit', value: 'ap', focused: true }] }]),
  });
  await settle();
  const callback = calls.find((call) => call.path.endsWith('/callback'));
  assert.equal(callback.body.type, 8);
  assert.deepEqual(callback.body.data.choices, [{ name: 'apple', value: 'apple' }, { name: 'Apricot', value: 'apricot' }, { name: '3', value: 3 }]);
});

test('replies with a private error message when a routed handler fails before answering', async (t) => {
  const { client, calls } = await setup(t);
  const reported = [];
  client.on('error', (error, context) => reported.push([error.message, context.interaction?.id]));
  client.command('boom', () => { throw new Error('exploded'); });
  client.command('late', async (interaction) => { await interaction.reply('ok'); throw new Error('after reply'); });
  await dispatch(client, 'INTERACTION_CREATE', { ...base, type: 2, data: commandData('boom') });
  await dispatch(client, 'INTERACTION_CREATE', { ...base, id: '901', type: 2, data: commandData('late') });
  await settle();
  await settle();
  assert.deepEqual(reported, [['exploded', '900'], ['after reply', '901']]);
  const callbacks = calls.filter((call) => call.path.endsWith('/callback'));
  assert.equal(callbacks.length, 2);
  assert.deepEqual(callbacks[0].body.data, { content: 'Something went wrong while running this command.', flags: 64 });
  assert.equal(callbacks[1].body.data.content, 'ok');
});

test('lets you customize or disable the error reply', async (t) => {
  const custom = await setup(t, undefined, { errorReply: (error) => 'custom: ' + error.message });
  custom.client.on('error', () => {});
  custom.client.command('boom', () => { throw new Error('x'); });
  await dispatch(custom.client, 'INTERACTION_CREATE', { ...base, type: 2, data: commandData('boom') });
  await settle();
  await settle();
  assert.equal(custom.calls.find((call) => call.path.endsWith('/callback')).body.data.content, 'custom: x');

  const silent = await setup(t, undefined, { errorReply: false });
  silent.client.on('error', () => {});
  silent.client.command('boom', () => { throw new Error('x'); });
  await dispatch(silent.client, 'INTERACTION_CREATE', { ...base, type: 2, data: commandData('boom') });
  await settle();
  await settle();
  assert.equal(silent.calls.filter((call) => call.path.endsWith('/callback')).length, 0);
});

test('uses a generic error reply when the custom formatter throws', async (t) => {
  const { client, calls } = await setup(t, undefined, { errorReply: () => { throw new Error('formatter failed'); } });
  const reported = [];
  client.on('error', (error) => reported.push(error.message));
  client.command('boom', () => { throw new Error('handler failed'); });

  await dispatch(client, 'INTERACTION_CREATE', { ...base, type: 2, data: commandData('boom') });
  await settle();

  assert.deepEqual(reported, ['handler failed', 'formatter failed']);
  assert.equal(calls.find((call) => call.path.endsWith('/callback')).body.data.content,
    'Something went wrong while running this command.');
});

test('still emits interactionCreate for unrouted interactions', async (t) => {
  const { client } = await setup(t);
  const seen = [];
  client.on('interactionCreate', (interaction) => seen.push([interaction.type, interaction.isCommand(), interaction.isComponent(), interaction.guild, interaction.channel.id, interaction.locale]));
  await dispatch(client, 'INTERACTION_CREATE', { ...base, type: 2, data: commandData('nothing') });
  await settle();
  assert.deepEqual(seen, [[2, true, false, undefined, '20', 'tr']]);
});

test('translates replies with a message catalog and the interaction locale', async (t) => {
  const { client, calls } = await setup(t);
  const catalog = new MessageCatalog('en', { en: { hello: 'Hello %s' }, tr: { hello: 'Merhaba %s' } });
  client.command('hi', (interaction) => interaction.reply(interaction.text(catalog, 'hello', interaction.user.displayName)));
  await dispatch(client, 'INTERACTION_CREATE', { ...base, type: 2, data: commandData('hi') });
  await settle();
  assert.equal(calls.find((call) => call.path.endsWith('/callback')).body.data.content, 'Merhaba Ada');
});

test('awaits the next matching interaction with a timeout and an abort signal', async (t) => {
  const { client } = await setup(t);
  const waiting = client.awaitInteraction({ filter: (interaction) => interaction.customId === 'yes', timeoutMs: 1000 });
  await dispatch(client, 'INTERACTION_CREATE', { ...base, type: 3, data: { custom_id: 'no', component_type: 2 } });
  await dispatch(client, 'INTERACTION_CREATE', { ...base, id: '901', type: 3, data: { custom_id: 'yes', component_type: 2 } });
  const interaction = await waiting;
  assert.equal(interaction.customId, 'yes');
  await assert.rejects(client.awaitInteraction({ timeoutMs: 10 }), /Timed out/);
  const controller = new AbortController();
  const aborted = client.awaitInteraction({ signal: controller.signal });
  controller.abort(new Error('stop'));
  await assert.rejects(aborted, /stop/);
});

test('builds slash commands with options first, subcommands and localizations', () => {
  assert.throws(() => new SlashCommand('bad', 'Bad').setDefaultMemberPermissions(-1n), TypeError);
  assert.throws(() => new SlashCommand('bad', 'Bad').setDefaultMemberPermissions(1), TypeError);
  const command = new SlashCommand('tool', 'Small tools')
    .setNameLocalizations({ tr: 'arac' })
    .setDefaultMemberPermissions(Permission.ManageGuild)
    .setDMPermission(false)
    .addSubcommand('echo', 'Repeat', (sub) => sub.addString('text', 'Text').addBoolean('loud', 'Loud', { required: true }))
    .addSubcommandGroup('admin', 'Admin', (group) => group.addSubcommand('reset', 'Reset'))
    .toJSON;
  assert.throws(() => command.call(new SlashCommand('mixed', 'Mixed').addString('a', 'A').addSubcommand('b', 'B')), /not both/);

  const built = new SlashCommand('tool', 'Small tools')
    .setNameLocalizations({ tr: 'arac' })
    .setDefaultMemberPermissions(Permission.ManageGuild)
    .setDMPermission(false)
    .addSubcommand('echo', 'Repeat', (sub) => sub.addString('text', 'Text', { choices: ['a', { name: 'B', value: 'b' }], maxLength: 10 }).addBoolean('loud', 'Loud', { required: true }))
    .addSubcommandGroup('admin', 'Admin', (group) => group.addSubcommand('reset', 'Reset'))
    .toJSON();
  assert.equal(built.name, 'tool');
  assert.equal(built.type, 1);
  assert.deepEqual(built.name_localizations, { tr: 'arac' });
  assert.equal(built.default_member_permissions, String(Permission.ManageGuild));
  assert.equal(built.dm_permission, false);
  const echo = built.options[0];
  assert.equal(echo.type, 1);
  assert.deepEqual(echo.options.map((option) => option.name), ['loud', 'text']);
  assert.deepEqual(echo.options[1].choices, [{ name: 'a', value: 'a' }, { name: 'B', value: 'b' }]);
  assert.equal(echo.options[1].max_length, 10);
  assert.equal(built.options[1].type, 2);
  assert.equal(built.options[1].options[0].name, 'reset');

  const options = new SlashCommand('opts', 'Options')
    .addInteger('n', 'N', { minValue: 1, maxValue: 5, choices: [1, 2] })
    .addNumber('x', 'X', { autocomplete: true })
    .addUser('u', 'U').addRole('r', 'R').addMentionable('m', 'M').addAttachment('f', 'F').addChannel('c', 'C', { channelTypes: [0, 2] })
    .toJSON().options;
  assert.deepEqual(options.map((option) => option.type), [4, 10, 6, 8, 9, 11, 7]);
  assert.equal(options[0].min_value, 1);
  assert.deepEqual(options[0].choices.map((choice) => choice.value), [1, 2]);
  assert.equal(options[1].autocomplete, true);
  assert.deepEqual(options[6].channel_types, [0, 2]);
  assert.throws(() => new SlashCommand('dup', 'Dup').addString('a', 'A').addString('a', 'A'), /Duplicate/);
  assert.throws(() => new SlashCommand('sparse', 'Sparse').addString('x', 'X', { choices: Array(1) }), TypeError);
  assert.throws(() => new SlashCommand('sparse', 'Sparse').addInteger('x', 'X', { choices: Array(1) }), TypeError);
  assert.throws(() => new SlashCommand('sparse', 'Sparse').addChannel('x', 'X', { channelTypes: Array(1) }), TypeError);
});

test('registers commands by creating, updating, skipping and pruning', async (t) => {
  const existing = [
    { id: '1', name: 'same', description: 'Same', type: 1, options: [{ type: 3, name: 'x', description: 'X', required: false }] },
    { id: '2', name: 'changed', description: 'Old text', type: 1 },
    { id: '3', name: 'gone', description: 'Gone', type: 1 },
  ];
  const { client, calls } = await setup(t, (url, init) => Response.json(init.method === 'GET' ? existing : { id: '9', name: 'x' }));
  client.command(new SlashCommand('same', 'Same').addString('x', 'X'), () => {});
  client.command(new SlashCommand('changed', 'New text'));
  client.command(new SlashCommand('fresh', 'Fresh'));
  const result = await client.registerCommands({ guildId: '10', prune: true });
  assert.deepEqual(result, { created: ['fresh'], updated: ['changed'], unchanged: ['same'], deleted: ['gone'] });
  const writes = calls.filter((call) => call.method !== 'GET').map((call) => call.method + ' ' + call.path);
  assert.deepEqual(writes, ['PATCH /applications/77/guilds/10/commands/2', 'POST /applications/77/guilds/10/commands', 'DELETE /applications/77/guilds/10/commands/3']);
  const withoutPrune = await client.registerCommands({ guildId: '10' });
  assert.deepEqual(withoutPrune.deleted, []);
});

test('registers its commands once when the client becomes ready', async (t) => {
  const { client, calls } = await setup(t, (url, init) => Response.json(init.method === 'GET' ? [] : { id: '9', name: 'x' }), { registerCommands: { guildId: '10' } });
  assert.equal(calls.length, 0);
  const second = new Client({ rest: client.rest, gateway: false, registerCommands: { guildId: '10' } });
  second.command(new SlashCommand('hello', 'Hello'), () => {});
  const readyCalls = [];
  second.on('ready', (ready) => readyCalls.push(ready === second));
  await second.login();
  assert.deepEqual(readyCalls, [true]);
  assert.deepEqual(calls.map((call) => call.method + ' ' + call.path), ['GET /applications/77/guilds/10/commands', 'POST /applications/77/guilds/10/commands']);

  const disabled = new Client({ rest: client.rest, gateway: false, registerCommands: false });
  disabled.command(new SlashCommand('quiet', 'Quiet'), () => {});
  const before = calls.length;
  await disabled.login();
  assert.equal(calls.length, before);
});

test('wraps users, members and channels with working helpers', async (t) => {
  const { client, calls } = await setup(t, (url, init) => {
    if (url.pathname === '/api/v1/users/@me/channels') return Response.json({ id: '33', type: 1 });
    if (url.pathname === '/api/v1/users/5') return Response.json(author);
    if (url.pathname.includes('/members/5') && init.method === 'PATCH') return Response.json({ roles: ['9'], nick: 'New', user: author });
    return Response.json({ id: '901', channel_id: '33', content: 'dm', author: { id: '77', username: 'robot' } });
  });
  const user = await client.users.fetch('5');
  assert.equal(user.id, '5');
  const dm = await user.send('hello');
  assert.equal(dm.channelId, '33');
  const channel = await user.createDM();
  assert.equal(channel.isDM(), true);

  const { Member, Channel, User } = await import('micup.ts/easy');
  const wrappedUser = new User(client, { ...author, global_name: null, discriminator: '1234', system: true });
  assert.equal(wrappedUser.username, 'ada');
  assert.equal(wrappedUser.globalName, null);
  assert.equal(wrappedUser.displayName, 'ada');
  assert.equal(wrappedUser.tag, 'ada#1234');
  assert.equal(wrappedUser.bot, false);
  assert.equal(wrappedUser.system, true);
  assert.equal(wrappedUser.mention, '<@5>');
  assert.equal(wrappedUser.equals('5'), true);
  assert.equal(wrappedUser.equals({ id: '6' }), false);
  assert.equal(wrappedUser.toString(), '<@5>');
  assert.equal(wrappedUser.avatarURL(), '');
  assert.equal(wrappedUser.bannerURL(), '');
  const member = new Member(client, { roles: ['9'], user: author, communication_disabled_until: '2999-01-01T00:00:00Z', joined_at: '2026-01-01T00:00:00Z' }, '10');
  assert.equal(member.isTimedOut(), true);
  assert.equal(member.hasRole('9'), true);
  assert.equal(member.hasPermission(Permission.SendMessages), false);
  assert.equal(member.id, '5');
  assert.equal(member.nick, null);
  assert.deepEqual(member.roles, ['9']);
  assert.equal(member.displayName, 'Ada');
  assert.equal(member.joinedAt.toISOString(), '2026-01-01T00:00:00.000Z');
  assert.equal(member.bot, false);
  assert.equal(member.guild, undefined);
  assert.equal(member.avatarURL(), '');
  assert.equal(member.toString(), '<@5>');
  assert.equal((await member.setNickname('New')).nick, 'New');
  await member.addRole('10');
  await member.removeRole('10');
  await member.kick({ reason: 'x' });
  await member.ban({ reason: 'bad', delete_message_seconds: 60 });
  const paths = calls.map((call) => call.method + ' ' + call.path);
  assert.ok(paths.includes('PUT /guilds/10/members/5/roles/10'));
  assert.ok(paths.includes('DELETE /guilds/10/members/5/roles/10'));
  assert.ok(paths.includes('DELETE /guilds/10/members/5'));
  const ban = calls.find((call) => call.method === 'PUT' && call.path === '/guilds/10/bans/5');
  assert.equal(ban.body.delete_message_seconds, 60);

  const text = new Channel(client, { id: '20', type: 0, guild_id: '10' });
  assert.equal(text.isText(), true);
  assert.equal(new Channel(client, { id: '21', type: 11 }).isThread(), true);
  assert.equal(new Channel(client, { id: '22', type: 2 }).isVoice(), true);
  assert.equal(text.name, undefined);
  assert.equal(text.topic, null);
  assert.equal(text.guildId, '10');
  assert.equal(text.parentId, null);
  assert.equal(text.nsfw, false);
  assert.equal(text.mention, '<#20>');
  assert.equal(text.guild, undefined);
  assert.equal(text.isVoice(), false);
  assert.equal(text.isDM(), false);
  assert.equal(text.isCategory(), false);
  assert.equal(text.isForum(), false);
  assert.equal(text.toString(), '<#20>');
  assert.equal(new Channel(client, { id: '23', type: 1 }).isDM(), true);
  assert.equal(new Channel(client, { id: '24', type: 4 }).isCategory(), true);
  assert.equal(new Channel(client, { id: '25', type: 15 }).isForum(), true);
  await text.sendTyping();
  await text.bulkDelete([{ id: '1' }, '2']);
  assert.ok(calls.some((call) => call.path === '/channels/20/typing'));
  assert.deepEqual(calls.find((call) => call.path === '/channels/20/messages/bulk-delete').body.message_ids, ['1', '2']);
});

test('exposes the full SDK next to the easy client', async () => {
  const easy = await import('micup.ts/easy');
  const main = await import('micup.ts');
  assert.equal(easy.MicupClient, main.MicupClient);
  assert.equal(easy.EmbedBuilder, main.EmbedBuilder);
  assert.equal(typeof easy.primaryButton, 'function');
  assert.deepEqual(primaryButton('a', 'A'), main.primaryButton('a', 'A'));
});

const pageMessage = { id: '950', channel_id: '20', content: 'x', author: { id: '77', username: 'robot' } };
const callbacks = (calls) => calls.filter((call) => call.path.endsWith('/callback'));
const buttons = (body) => body.components[0].components.map((button) => [button.label, button.disabled === true, button.custom_id.split(':')[1]]);
const click = (client, prefix, action, extra = {}) => dispatch(client, 'INTERACTION_CREATE', {
  ...base, id: String(2000 + ++sequence), type: 3, data: { custom_id: prefix + action, component_type: 2 }, message: pageMessage, ...extra,
});
const until = async (predicate) => { for (let i = 0; i < 400 && !predicate(); i++) await new Promise((resolve) => setTimeout(resolve, 5)); };

test('paginates pages with buttons, jumps between them and stops', async (t) => {
  const { client, calls } = await setup(t, () => Response.json(pageMessage));
  let result;
  client.command('list', async (interaction) => {
    result = await paginate(interaction, ['one', 'two', { content: 'three', embeds: [{ title: 'T' }] }], { timeoutMs: 5000 });
  });
  await dispatch(client, 'INTERACTION_CREATE', { ...base, type: 2, data: commandData('list') });
  await until(() => callbacks(calls).length >= 1);
  const initial = callbacks(calls)[0].body;
  assert.equal(initial.type, 4);
  assert.equal(initial.data.content, 'one');
  assert.deepEqual(buttons(initial.data), [['‹', true, 'previous'], ['1/3', true, 'page'], ['›', false, 'next'], ['✕', false, 'stop']]);
  const prefix = initial.data.components[0].components[0].custom_id.replace('previous', '');
  assert.match(prefix, /^pg-[a-z0-9]+:$/);

  await click(client, prefix, 'next');
  await until(() => callbacks(calls).length >= 2);
  const second = callbacks(calls)[1].body;
  assert.equal(second.type, 7);
  assert.equal(second.data.content, 'two');
  assert.deepEqual(buttons(second.data), [['‹', false, 'previous'], ['2/3', true, 'page'], ['›', false, 'next'], ['✕', false, 'stop']]);

  await click(client, prefix, 'next');
  await until(() => callbacks(calls).length >= 3);
  const third = callbacks(calls)[2].body.data;
  assert.equal(third.content, 'three');
  assert.deepEqual(third.embeds, [{ title: 'T' }]);
  assert.deepEqual(buttons(third), [['‹', false, 'previous'], ['3/3', true, 'page'], ['›', true, 'next'], ['✕', false, 'stop']]);

  await click(client, prefix, 'previous');
  await until(() => callbacks(calls).length >= 4);
  assert.equal(callbacks(calls)[3].body.data.content, 'two');
  assert.deepEqual(callbacks(calls)[3].body.data.embeds, []);

  await click(client, prefix, 'stop');
  await until(() => result);
  assert.deepEqual(result, { reason: 'stopped', page: 1 });
  assert.deepEqual(callbacks(calls)[4].body.data.components, []);
});

test('only the invoker can turn pages and others get a private notice', async (t) => {
  const { client, calls } = await setup(t, () => Response.json(pageMessage));
  let result;
  client.command('list', async (interaction) => { result = await paginate(interaction, ['a', 'b'], { timeoutMs: 5000 }); });
  await dispatch(client, 'INTERACTION_CREATE', { ...base, type: 2, data: commandData('list') });
  await until(() => callbacks(calls).length >= 1);
  const prefix = callbacks(calls)[0].body.data.components[0].components[0].custom_id.replace('previous', '');
  const stranger = { member: { roles: [], user: { id: '6', username: 'eve' } } };

  await click(client, prefix, 'next', stranger);
  await until(() => callbacks(calls).length >= 2);
  const denied = callbacks(calls)[1].body;
  assert.equal(denied.type, 4);
  assert.deepEqual(denied.data, { content: 'Only <@5> can use these buttons.', flags: 64 });
  assert.equal(result, undefined);

  await click(client, prefix, 'next');
  await until(() => callbacks(calls).length >= 3);
  assert.equal(callbacks(calls)[2].body.data.content, 'b');
  await click(client, prefix, 'stop');
  await until(() => result);
  assert.equal(result.reason, 'stopped');
});

test('disables the buttons after the idle timeout and honors an abort signal', async (t) => {
  const { client, calls } = await setup(t, () => Response.json(pageMessage));
  let result;
  client.command('list', async (interaction) => { result = await paginate(interaction, ['a', 'b', 'c'], { timeoutMs: 20 }); });
  await dispatch(client, 'INTERACTION_CREATE', { ...base, type: 2, data: commandData('list') });
  await until(() => result);
  assert.deepEqual(result, { reason: 'timeout', page: 0 });
  const edit = calls.find((call) => call.method === 'PATCH' && call.path === '/webhooks/77/tok/messages/@original');
  assert.ok(edit.body.components[0].components.every((button) => button.disabled === true));

  const controller = new AbortController();
  let aborted;
  client.command('stoppable', async (interaction) => { aborted = await paginate(interaction, ['a', 'b'], { timeoutMs: 5000, signal: controller.signal }); });
  await dispatch(client, 'INTERACTION_CREATE', { ...base, id: '901', type: 2, data: commandData('stoppable') });
  await settle();
  controller.abort();
  await until(() => aborted);
  assert.deepEqual(aborted, { reason: 'aborted', page: 0 });
});

test('loads pages lazily, shows jump buttons and starts on a chosen page', async (t) => {
  const { client, calls } = await setup(t, () => Response.json(pageMessage));
  const loaded = [];
  let result;
  client.command('list', async (interaction) => {
    result = await paginate(interaction, { count: 5, page: async (index) => { loaded.push(index); return 'page ' + index; } }, { jumpButtons: true, startPage: 2, timeoutMs: 5000, labels: { first: 'First' } });
  });
  await dispatch(client, 'INTERACTION_CREATE', { ...base, type: 2, data: commandData('list') });
  await until(() => callbacks(calls).length >= 1);
  const initial = callbacks(calls)[0].body.data;
  assert.equal(initial.content, 'page 2');
  assert.deepEqual(buttons(initial), [['First', false, 'first'], ['‹', false, 'previous'], ['3/5', true, 'page'], ['›', false, 'next'], ['»', false, 'last']]);
  const prefix = initial.components[0].components[0].custom_id.replace('first', '');

  await click(client, prefix, 'last');
  await until(() => callbacks(calls).length >= 2);
  assert.equal(callbacks(calls)[1].body.data.content, 'page 4');
  assert.deepEqual(buttons(callbacks(calls)[1].body.data).map(([label, disabled]) => [label, disabled]), [['First', false], ['‹', false], ['5/5', true], ['›', true], ['»', true]]);
  await click(client, prefix, 'first');
  await until(() => callbacks(calls).length >= 3);
  assert.equal(callbacks(calls)[2].body.data.content, 'page 0');
  assert.deepEqual(loaded, [2, 4, 0]);
  client.destroy();
});

test('sends a single page without buttons and paginates a message with replies', async (t) => {
  const { client, calls } = await setup(t, (url) => Response.json(url.pathname.endsWith('/messages') ? { ...pageMessage, id: '951' } : pageMessage));
  const results = [];
  client.command('one', async (interaction) => { results.push(await paginate(interaction, ['only'])); });
  await dispatch(client, 'INTERACTION_CREATE', { ...base, type: 2, data: commandData('one') });
  await until(() => results.length);
  assert.deepEqual(results[0], { reason: 'finished', page: 0 });
  assert.deepEqual(callbacks(calls)[0].body.data.components, []);
  assert.equal(callbacks(calls)[0].body.data.content, 'only');

  client.on('messageCreate', async (message) => { results.push(await paginate(message, ['m1', 'm2'], { timeoutMs: 5000 })); });
  await dispatch(client, 'MESSAGE_CREATE', { id: '800', channel_id: '20', guild_id: '10', content: '!list', author });
  await until(() => calls.some((call) => call.method === 'POST' && call.path === '/channels/20/messages'));
  const sent = calls.find((call) => call.method === 'POST' && call.path === '/channels/20/messages');
  assert.equal(sent.body.content, 'm1');
  assert.equal(sent.body.message_reference.message_id, '800');
  const prefix = sent.body.components[0].components[0].custom_id.replace('previous', '');
  await click(client, prefix, 'stop');
  await until(() => results.length === 2);
  assert.equal(results[1].reason, 'stopped');
});

test('rejects empty page sources and invalid start pages', async (t) => {
  const { client } = await setup(t);
  const seen = [];
  client.command('bad', async (interaction) => {
    await assert.rejects(paginate(interaction, []), RangeError);
    await assert.rejects(paginate(interaction, { count: 0, page: () => 'x' }), RangeError);
    await assert.rejects(paginate(interaction, ['a'], { startPage: 3 }), RangeError);
    seen.push('checked');
  });
  await dispatch(client, 'INTERACTION_CREATE', { ...base, type: 2, data: commandData('bad') });
  await until(() => seen.length);
  assert.deepEqual(seen, ['checked']);
});
