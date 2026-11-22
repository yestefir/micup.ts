import assert from 'node:assert/strict';
import { MicupClient, MicupUserSession } from '../dist/index.js';

const token = process.env.MICUP_TEST_BOT_TOKEN;
if (!token) throw new Error('Set MICUP_TEST_BOT_TOKEN to run the live smoke checks');
const origin = process.env.MICUP_TEST_ORIGIN;
if (!origin) throw new Error('Set MICUP_TEST_ORIGIN to the sandbox origin; live smoke checks do not default to production');
const userToken = process.env.MICUP_TEST_USER_TOKEN;
if (userToken && userToken === token) throw new Error('Bot and user smoke checks require separate credentials');

const client = await MicupClient.connect({
  token,
  origin,
});

assert.equal(client.self.bot, true, 'the credential must belong to a bot');
assert.equal(typeof client.self.id, 'string');
assert.ok(client.self.id.length > 0);
process.stdout.write('REST identity check passed\n');

const application = await client.application();
assert.equal(typeof application.id, 'string');
assert.ok(application.id.length > 0);
process.stdout.write('REST application check passed\n');

const shardCount = await client.recommendedShards();
assert.ok(Number.isSafeInteger(shardCount) && shardCount >= 1, 'the API must recommend at least one shard');
process.stdout.write('Guild listing and shard recommendation check passed\n');

const guilds = await client.users.guilds({ limit: 1 });
assert.ok(Array.isArray(guilds), 'the guild listing must be an array');
if (guilds.length > 0) {
  const guildId = guilds[0].id;
  assert.equal(typeof guildId, 'string');
  const [guild, channels, roles, member] = await Promise.all([
    client.guilds.get(guildId),
    client.guilds.channels(guildId),
    client.guilds.roles(guildId),
    client.guilds.currentMember(guildId),
  ]);
  assert.equal(guild.id, guildId, 'the guild detail must match the listed guild');
  assert.ok(Array.isArray(channels), 'guild channels must be an array');
  assert.ok(Array.isArray(roles), 'guild roles must be an array');
  assert.ok(Array.isArray(member.roles), 'the current guild member must have a role list');
  if (channels.length > 0) {
    const channel = await client.channels.get(channels[0].id);
    assert.equal(channel.id, channels[0].id, 'the channel detail must match the listed channel');
  }
  process.stdout.write('Guild, role, member and channel read scenario passed\n');
} else {
  process.stdout.write('Guild detail scenario skipped because the bot has no guilds\n');
}

const stop = new AbortController();
const deadline = AbortSignal.timeout(20_000);
let gatewayReady = false;
const session = client.newSession({
  handler: async (event) => {
    if (event.name === 'READY' || event.name === 'RESUMED') {
      gatewayReady = true;
      stop.abort();
    }
  },
});

try {
  await session.run({ signal: AbortSignal.any([stop.signal, deadline]) });
} finally {
  stop.abort();
}

assert.equal(gatewayReady, true, 'the Gateway did not become ready before the deadline');
assert.equal(session.ready, false, 'the smoke session should be closed after its handshake');
process.stdout.write('Gateway handshake check passed\n');

if (userToken) {
  const userSession = await MicupUserSession.connect({ token: userToken, origin });
  assert.equal(userSession.self.bot, false, 'the credential must belong to a user');
  assert.equal(typeof userSession.self.id, 'string');
  assert.ok(userSession.self.id.length > 0);
  process.stdout.write('User identity check passed\n');
}
