import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  AuditAction, ChannelType, ElevatedPermissions, GatewayCloseCode, GuildFeature, Limits, MessageType, Permission, UserFlag, VoiceRefusalCode,
  buttonRow, channelSelect, commandOption, defaultChannel, defaultRole, defaultUser, dangerButton, disableButtons, focusedOption, guildHasFeature,
  hasMessageFlag, hasPermissions, imageData, interactionCustomId, interactionInvoker, isButtonInteraction, isDMChannel, isForumChannel, isReply, isSelectInteraction,
  isThreadChannel, leafOptions, linkButton, memberTimedOut, missingPermissions, modalValue, optionBoolean, optionInteger, optionMember, optionNumber,
  optionString, optionUser, paragraphInput, parsePermission, permissionNames, primaryButton, roleSelect, secondaryButton, selectOption, selectRow,
  selectedMembers, selectedUsers, shortInput, stringSelect, successButton, targetMessage, targetUser, userSelect, mentionableSelect,
  selectedChannels, selectedRoles,
} from 'micup.ts';

test('exposes the Go constant groups with the production values', () => {
  assert.equal(ChannelType.GuildVoice, 2);
  assert.equal(ChannelType.PublicThread, 11);
  assert.equal(ChannelType.GuildLink, 998);
  assert.equal(AuditAction.MemberBanAdd, 22);
  assert.equal(AuditAction.ThreadDelete, 112);
  assert.equal(MessageType.Reply, 19);
  assert.equal(UserFlag.ProfileHidden, 1 << 7);
  assert.equal(GuildFeature.VanityURL, 'VANITY_URL');
  assert.equal(GatewayCloseCode.ShardingRequired, 4011);
  assert.equal(VoiceRefusalCode.ChannelFull, 'VOICE_CHANNEL_FULL');
  assert.equal(Limits.EmbedTitle, 256);
  assert.equal(Limits.BulkDelete, 100);
  assert.equal(Limits.SelectOptions, 25);
});

test('names, parses and compares permissions', () => {
  assert.deepEqual(permissionNames(Permission.SendMessages | Permission.ManageRoomStage), ['SEND_MESSAGES', 'MANAGE_ROOM_STAGE']);
  assert.equal(parsePermission(' manage_guild '), Permission.ManageGuild);
  assert.equal(parsePermission('NOPE'), undefined);
  assert.equal(missingPermissions(Permission.ViewChannel, Permission.ViewChannel | Permission.SendMessages), Permission.SendMessages);
  assert.equal(missingPermissions(Permission.Administrator, Permission.SendMessages), 0n);
  assert.equal(hasPermissions(Permission.ViewChannel | Permission.SendMessages, Permission.SendMessages), true);
  assert.throws(() => hasPermissions(-1n, Permission.Administrator), TypeError);
  assert.throws(() => hasPermissions(Permission.Administrator, -1n), TypeError);
  assert.throws(() => missingPermissions(-1n, Permission.SendMessages), TypeError);
  assert.throws(() => missingPermissions(Permission.ViewChannel, -1n), TypeError);
  assert.throws(() => permissionNames(-1n), TypeError);
  assert.ok((ElevatedPermissions & Permission.KickMembers) !== 0n);
  assert.equal(ElevatedPermissions & Permission.SendMessages, 0n);
});

test('builds buttons, selects and inputs like the Go helpers', () => {
  assert.deepEqual(primaryButton('a', 'A'), { type: 2, style: 1, custom_id: 'a', label: 'A' });
  assert.equal(secondaryButton('a', 'A').style, 2);
  assert.equal(successButton('a', 'A').style, 3);
  assert.equal(dangerButton('a', 'A').style, 4);
  assert.deepEqual(linkButton('https://micup.gg', 'Site'), { type: 2, style: 5, url: 'https://micup.gg', label: 'Site' });
  assert.deepEqual(stringSelect('s', selectOption('A', 'a')), { type: 3, custom_id: 's', options: [{ label: 'A', value: 'a' }] });
  assert.equal(userSelect('u').type, 5);
  assert.equal(roleSelect('r').type, 6);
  assert.equal(mentionableSelect('m').type, 7);
  assert.deepEqual(channelSelect('c', 0, 2), { type: 8, custom_id: 'c', channel_types: [0, 2] });
  assert.deepEqual(channelSelect('c'), { type: 8, custom_id: 'c' });
  assert.deepEqual([defaultUser('1'), defaultRole('2'), defaultChannel('3')].map((item) => item.type), ['user', 'role', 'channel']);
  assert.equal(shortInput('i', 'I').style, 1);
  assert.equal(paragraphInput('i', 'I').style, 2);
  assert.doesNotThrow(() => selectRow(stringSelect('s', selectOption('A', 'a'))));

  const rows = [buttonRow(primaryButton('a', 'A'), linkButton('https://micup.gg', 'Site')), selectRow(stringSelect('s', selectOption('A', 'a')))];
  const disabled = disableButtons(rows);
  assert.equal(disabled[0].components[0].disabled, true);
  assert.equal(disabled[0].components[1].disabled, undefined);
  assert.equal(disabled[1].components[0].disabled, undefined);
  assert.equal(rows[0].components[0].disabled, undefined);
  assert.throws(() => disableButtons(Array(1)), TypeError);
  assert.throws(() => disableButtons([{ type: 1, components: Array(1) }]), TypeError);
});

test('encodes image data', () => {
  assert.equal(imageData('image/png', new Uint8Array([1, 2, 3])), 'data:image/png;base64,AQID');
  assert.throws(() => imageData('', new Uint8Array([1])), TypeError);
  assert.throws(() => imageData('image/png', new Uint8Array()), TypeError);
});

const user = { id: '5', username: 'ada' };
const resolved = {
  users: { 5: user },
  members: { 5: { roles: ['9'], nick: 'Ada' } },
  roles: { 9: { id: '9', name: 'r', position: 1, permissions: '0' } },
  channels: { 7: { id: '7', type: 0 } },
  attachments: { 3: { id: '3', filename: 'a.txt', url: 'https://x' } },
  messages: { 4: { id: '4', channel_id: '7', content: 'm', author: user } },
};

test('reads command options, nested paths and resolved entities', () => {
  const data = {
    id: '1', name: 'tool', target_id: '5', resolved,
    options: [{
      type: 1, name: 'run', options: [
        { type: 3, name: 'text', value: 'merhaba' }, { type: 4, name: 'count', value: 3 }, { type: 10, name: 'ratio', value: 1.5 },
        { type: 5, name: 'flag', value: true }, { type: 6, name: 'who', value: '5' }, { type: 8, name: 'role', value: '9' },
        { type: 7, name: 'where', value: '7' }, { type: 11, name: 'file', value: '3' }, { type: 3, name: 'typed', value: 'ap', focused: true },
      ],
    }],
  };
  assert.equal(leafOptions(data).length, 9);
  assert.equal(optionString(data, 'text'), 'merhaba');
  assert.equal(optionString(data, 'missing'), undefined);
  assert.equal(optionInteger(data, 'count'), 3);
  assert.equal(optionInteger(data, 'ratio'), undefined);
  assert.equal(optionNumber(data, 'ratio'), 1.5);
  assert.equal(optionBoolean(data, 'flag'), true);
  assert.equal(optionUser(data, 'who').username, 'ada');
  assert.equal(optionMember(data, 'who').nick, 'Ada');
  assert.equal(optionMember(data, 'who').user.id, '5');
  assert.equal(commandOption(data, 'role').value, '9');
  assert.equal(focusedOption(data).name, 'typed');
  assert.equal(targetUser(data).id, '5');
  assert.equal(optionUser({ ...data, resolved: undefined }, 'who'), undefined);
  assert.equal(targetMessage({ ...data, target_id: '4' }).id, '4');
  assert.equal(targetMessage({ id: '1', name: 'x' }), undefined);
});

test('reads modal values, selections and interaction kinds', () => {
  const modal = { custom_id: 'm', components: [{ type: 1, components: [{ type: 4, custom_id: 'name', value: 'Ada' }] }] };
  assert.equal(modalValue(modal, 'name'), 'Ada');
  assert.equal(modalValue(modal, 'other'), undefined);

  const picked = { custom_id: 's', component_type: 5, values: ['5', '9', '7'], resolved };
  assert.deepEqual(selectedUsers(picked).map((item) => item.id), ['5']);
  assert.equal(selectedMembers(picked)[0].user.username, 'ada');
  assert.deepEqual(selectedRoles(picked).map((item) => item.id), ['9']);
  assert.deepEqual(selectedChannels(picked).map((item) => item.id), ['7']);

  const base = { id: '1', application_id: '2', token: 't', member: { roles: [], user } };
  const button = { ...base, type: 3, data: { custom_id: 'b', component_type: 2 } };
  const select = { ...base, type: 3, data: { custom_id: 's', component_type: 3, values: ['a'] } };
  assert.equal(isButtonInteraction(button), true);
  assert.equal(isSelectInteraction(button), false);
  assert.equal(isSelectInteraction(select), true);
  assert.equal(interactionCustomId(select), 's');
  assert.equal(interactionCustomId({ ...base, type: 2, data: { id: '1', name: 'x' } }), undefined);
  assert.equal(interactionInvoker(button).id, '5');
  assert.equal(interactionInvoker({ id: '1', application_id: '2', token: 't', type: 1, user }).id, '5');
});

test('classifies channels, messages, members and guilds', () => {
  assert.equal(isDMChannel({ type: 1 }), true);
  assert.equal(isDMChannel({ type: 3 }), true);
  assert.equal(isDMChannel({ type: 0 }), false);
  assert.equal(isThreadChannel({ type: 12 }), true);
  assert.equal(isThreadChannel({ type: 0 }), false);
  assert.equal(isForumChannel({ type: 16 }), true);
  assert.equal(isReply({ type: 19 }), true);
  assert.equal(hasMessageFlag({ flags: 4 | 4096 }, 4), true);
  assert.equal(hasMessageFlag({}, 4), false);
  const now = new Date('2026-01-01T00:00:00Z');
  assert.equal(memberTimedOut({ communication_disabled_until: '2026-01-02T00:00:00Z' }, now), true);
  assert.equal(memberTimedOut({ communication_disabled_until: '2025-12-31T00:00:00Z' }, now), false);
  assert.equal(memberTimedOut({}, now), false);
  assert.equal(guildHasFeature({ features: ['VERIFIED'] }, 'VERIFIED'), true);
  assert.equal(guildHasFeature({}, 'VERIFIED'), false);
});
