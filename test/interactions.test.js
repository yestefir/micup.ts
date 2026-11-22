import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CommandOptionType, EventMux, InteractionRouter, InteractionType, MicupClient } from 'micup.ts';

test('registers a guild command and routes an interaction to an ephemeral response', async (t) => {
  const origin = 'https://micup.example';
  const command = {
    name: 'echo', description: 'Repeat text',
    options: [{ type: CommandOptionType.String, name: 'text', description: 'Message', required: true }],
  };
  const fetch = t.mock.method(globalThis, 'fetch', async (url, options) => {
    const path = new URL(url).pathname;
    if (path === '/.well-known/fluxer') return Response.json({ endpoints: { api_public: origin + '/api' } });
    if (path === '/api/v1/users/@me') return Response.json({ id: '10', bot: true });
    if (path === '/api/v1/applications/10/guilds/20/commands') {
      assert.equal(options.method, 'PUT');
      assert.deepEqual(JSON.parse(options.body), [{ type: 1, ...command }]);
      return Response.json([{ id: '30', ...command }]);
    }
    assert.equal(path, '/api/v1/interactions/40/fixture-token/callback');
    assert.equal(options.method, 'POST');
    assert.deepEqual(JSON.parse(options.body), { type: 4, data: { content: 'hello', flags: 64 } });
    return new Response(null, { status: 204 });
  });

  const client = await MicupClient.connect({ origin, token: 'fixture' });
  assert.throws(() => client.commands.set([{ name: 'INVALID', description: 'fixture' }], { guildId: '20' }), /Invalid/);
  const [registered] = await client.commands.set([command], { guildId: '20' });
  assert.equal(registered.id, '30');

  const router = new InteractionRouter().command('echo', (interaction, signal) =>
    client.interactions.respond(interaction, interaction.data.options[0].value, { ephemeral: true, signal }));
  const mux = new EventMux();
  mux.on('INTERACTION_CREATE', async (interaction, event, signal) => {
    assert.equal(await router.handle(interaction, signal), true);
  });
  const interaction = {
    id: '40', application_id: '10', token: 'fixture-token', type: InteractionType.Command,
    data: { id: '30', name: 'echo', options: [{ name: 'text', type: CommandOptionType.String, value: 'hello' }] },
  };
  await mux.handle({ name: 'INTERACTION_CREATE', data: interaction, sequence: 2, shardId: 0 }, new AbortController().signal);
  assert.equal(fetch.mock.callCount(), 4);
});

test('prefers exact interaction routes and uses the longest matching prefix otherwise', async () => {
  const calls = [];
  const router = new InteractionRouter()
    .component('page:*', () => { calls.push('broad'); })
    .component('page:admin:*', () => { calls.push('prefix'); })
    .component('page:admin:1', () => { calls.push('exact'); });
  const signal = new AbortController().signal;
  for (const key of ['page:admin:1', 'page:admin:2', 'page:2', 'skip']) {
    await router.handle({
      id: '10', application_id: '10', token: 'fixture', type: InteractionType.Component,
      data: { custom_id: key, component_type: 2 },
    }, signal);
  }
  assert.deepEqual(calls, ['exact', 'prefix', 'broad']);
});
