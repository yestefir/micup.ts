import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ButtonStyle, ComponentType, EmbedBuilder, inviteURL, MessageCatalog, MicupMedia, validateEmbed,
  TimestampStyle, actionRow, disableComponents, formatTimestamp, knownGatewayEvents, mentionChannel,
  modalRows, selectRow, snowflakeAt, snowflakeTime,
} from 'micup.ts';

test('discovers gateway names and preserves snowflake precision and locale fallback', () => {
  assert.ok(knownGatewayEvents.includes('GUILD_MEMBER_LIST_UPDATE'));
  assert.equal(new Set(knownGatewayEvents).size, knownGatewayEvents.length);
  const at = new Date('2026-01-02T03:04:05.000Z');
  assert.equal(snowflakeTime(snowflakeAt(at)).toISOString(), at.toISOString());
  assert.equal(formatTimestamp(at, TimestampStyle.Relative), '<t:1767323045:R>');
  assert.equal(mentionChannel('123'), '<#123>');
  const catalog = new MessageCatalog('en-US', {
    'en-US': { hello: 'Hello %s', bye: 'Goodbye' },
    tr: { hello: 'Merhaba %s' },
  });
  assert.equal(catalog.text({ locale: 'tr-TR' }, 'hello', 'Micup'), 'Merhaba Micup');
  assert.equal(catalog.text({ locale: 'tr' }, 'bye'), 'Goodbye');
  assert.deepEqual(catalog.localizations('hello'), { tr: 'Merhaba %s' });
});

test('builds and validates components, embeds, and media URLs without mutating inputs', () => {
  const button = { type: ComponentType.Button, style: ButtonStyle.Primary, custom_id: 'play', label: 'Play' };
  const row = actionRow(button);
  const disabled = disableComponents([row]);
  assert.equal(disabled[0].components[0].disabled, true);
  assert.equal(row.components[0].disabled, undefined);
  assert.throws(() => disableComponents(Array(1)), TypeError);
  assert.throws(() => disableComponents([{ type: 1, components: Array(1) }]), TypeError);
  assert.throws(() => selectRow({ type: 3, custom_id: 'limit', options: [{ label: 'One', value: 'one' }], max_values: 2 }), /Invalid/);
  assert.equal(modalRows({ type: 4, style: 2, custom_id: 'answer', label: 'Answer' })[0].components[0].style, 2);
  assert.deepEqual(new EmbedBuilder().title('Fixture').field('Example', 'Value').build(), {
    title: 'Fixture', fields: [{ name: 'Example', value: 'Value', inline: undefined }],
  });
  assert.throws(() => new EmbedBuilder().title('x'.repeat(257)).build(), /title/);
  assert.throws(() => validateEmbed({ title: 'fixture', type: 'article' }), /Unsupported embed object field/);
  assert.throws(() => validateEmbed({ author: { name: 'fixture', proxy_icon_url: 'https://media.example/icon.png' } }), /Unsupported embed author field/);
  assert.throws(() => validateEmbed({ image: { url: 'https://media.example/image.png', proxy_url: 'https://proxy.example/image.png' } }), /Unsupported embed image field/);
  assert.throws(() => validateEmbed({ fields: [{ name: 'fixture', value: 'x', inline: 'yes' }] }), /inline flag/);
  assert.throws(() => validateEmbed({ url: 'javascript:alert(1)' }), /Invalid Micup embed link URL/);
  assert.doesNotThrow(() => validateEmbed({
    title: 'fixture', url: 'https://example.com', author: { name: 'author', icon_url: 'https://example.com/icon.png' },
    image: { url: 'attachment://image.png', description: 'image' }, fields: [{ name: 'field', value: '' }],
  }));
  const media = new MicupMedia('https://media.example/');
  assert.equal(media.userAvatar({ id: '20', username: 'fixture', avatar: 'a_hash' }, { format: 'png', size: 64 }),
    'https://media.example/avatars/20/a_hash.png?animated=false&size=64');
});

test('keeps media bases and invite links on safe public URL paths', () => {
  for (const base of ['javascript:alert(1)', 'data:text/plain,unsafe', 'https://user:pass@media.example', 'https://media.example?token=secret', 'https://media.example/#fragment']) {
    assert.equal(new MicupMedia(base).userAvatar({ id: '20', username: 'fixture', avatar: 'hash' }), '');
    assert.throws(() => inviteURL(base, 'valid-code'), /base URL and code/);
  }

  assert.equal(inviteURL('https://media.example/root/', 'a/b ?'), 'https://media.example/root/a%2Fb%20%3F');
  assert.equal(new MicupMedia('https://media.example/root/').stickerImage('sticker/a b'),
    'https://media.example/root/stickers/sticker%2Fa%20b.webp');
});
