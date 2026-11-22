import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GatewayState, Permission, hasPermissions } from 'micup.ts';

const role = (id, permissions) => ({ id, name: id, position: 0, permissions: String(permissions) });
const user = { id: '500', username: 'fixture' };
const apply = (state, name, data) => state.apply({ name, data, shardId: 0, sequence: 1 });

test('reconciles a guild snapshot, partial events, scoped thread sync and temporary outages', () => {
  const state = new GatewayState();
  const guild = {
    id: '100', properties: { name: 'Fixture' },
    roles: [role('100', 0n)],
    channels: [{ id: '200', type: 0 }, { id: '201', type: 0 }],
    threads: [{ id: '220', type: 11, parent_id: '200' }, { id: '221', type: 12, parent_id: '201' }],
    members: [{ user, roles: [] }],
  };
  apply(state, 'READY', { guilds: [guild] });
  assert.equal(state.guild('100').name, 'Fixture');
  assert.equal(state.guildForChannel('220'), '100');
  apply(state, 'CHANNEL_UPDATE', { id: '200', name: 'Renamed' });
  assert.equal(state.channel('200').guild_id, '100');
  assert.equal(state.channel('200').name, 'Renamed');
  apply(state, 'THREAD_LIST_SYNC', { guild_id: '100', channel_ids: ['200'], threads: [] });
  assert.equal(state.channel('220'), undefined);
  assert.equal(state.channel('221').id, '221');
  apply(state, 'GUILD_MEMBER_ADD', { guild_id: '100', user: { id: '501', username: 'stale' }, roles: [] });
  apply(state, 'GUILD_DELETE', { id: '100', unavailable: true });
  assert.equal(state.guild('100'), undefined);
  assert.equal(state.guildForChannel('221'), '100');
  apply(state, 'GUILD_SYNC', { ...guild, channels: [{ id: '202', type: 2 }], threads: [] });
  assert.equal(state.channel('201'), undefined);
  assert.equal(state.channel('202').guild_id, '100');
  assert.equal(state.member('100', '501'), undefined);
  assert.equal(state.member('100', user.id).user.username, 'fixture');
  apply(state, 'VOICE_STATE_UPDATE', { guild_id: '100', user_id: user.id, channel_id: '202' });
  assert.deepEqual(state.voiceMembers('100', '202'), [user.id]);
  apply(state, 'GUILD_MEMBER_REMOVE', { guild_id: '100', user });
  assert.deepEqual(state.voiceMembers('100', '202'), []);
  apply(state, 'GUILD_DELETE', { id: '100' });
  assert.equal(state.channel('202'), undefined);
  assert.equal(state.guildCount, 0);
});

test('computes permissions above 53 bits and inherits thread overwrites', () => {
  const state = new GatewayState();
  const high = Permission.ViewChannelMembers;
  apply(state, 'GUILD_CREATE', {
    id: '100', owner_id: '900',
    roles: [role('100', high | Permission.ViewChannel), role('250', Permission.SendMessages)],
    members: [{ user, roles: ['250'] }],
    channels: [{
      id: '200', type: 0,
      permission_overwrites: [
        { id: '100', type: 0, allow: '0', deny: String(Permission.ViewChannel) },
        { id: '250', type: 0, allow: String(Permission.ViewChannel), deny: String(Permission.SendMessages) },
        { id: user.id, type: 1, allow: String(Permission.SendMessages), deny: '0' },
      ],
    }],
    threads: [{ id: '300', type: 11, parent_id: '200' }],
  });
  const snapshot = state.channel('200');
  snapshot.permission_overwrites.pop();
  const permissions = state.permissions('100', user.id, '300');
  assert.ok(hasPermissions(permissions, high | Permission.ViewChannel | Permission.SendMessages));
  assert.equal(state.permissions('100', '900', '300'), Permission.All);
  assert.equal(state.permissions('100', 'missing', '300'), undefined);
});

test('keeps the guild owner permission override when a partial snapshot omits roles', () => {
  const state = new GatewayState();
  apply(state, 'GUILD_CREATE', { id: '100', owner_id: '900' });
  assert.equal(state.permissions('100', '900'), Permission.All);
  assert.equal(state.permissions('100', '901'), undefined);
  assert.equal(state.permissions('100', '900', 'missing-channel'), undefined);
});
