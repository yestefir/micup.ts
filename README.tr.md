# micup.ts

[Micup](https://micup.gg) botları için TypeScript SDK'sı. Botu Micup Gateway ve REST API'sine yeniden bağlanma, oturum sürdürme (resume), shard desteği, hız sınırı yönetimi ve tam tip tanımlarıyla bağlar. Slash komutları, butonlar, seçim menüleri, modallar, soundboard, ses odaları ve ses çalmayı kapsar.

[English README](README.md) · [Dokümantasyon](docs/README.md) · [Değişiklik günlüğü](CHANGELOG.md)

```sh
npm install micup.ts
```

Node.js 22 veya üstü ve bir Micup bot token'ı gerekir. Üretimdeki botları çalıştıran Go kütüphanesi [micup.go](https://github.com/yestefir/micup.go) temel alınmıştır.

## Hızlı başlangıç

Mesaj gönderme:

```js
import { MicupClient } from 'micup.ts';

const client = await MicupClient.connect({ token: process.env.MICUP_BOT_TOKEN });
console.log(client.self.username);
await client.sendMessage(process.env.MICUP_CHANNEL_ID, 'Merhaba!');
```

Komut ve butona yanıt verme:

```js
import { EventMux, InteractionRouter, MicupClient, actionRow, primaryButton } from 'micup.ts';

const client = await MicupClient.connect({ token: process.env.MICUP_BOT_TOKEN });
await client.commands.create({ name: 'ping', description: 'Botu dene' }, { guildId: process.env.MICUP_GUILD_ID });

const router = new InteractionRouter()
  .command('ping', (interaction, signal) =>
    client.interactions.respond(interaction, {
      content: 'pong',
      components: [actionRow(primaryButton('again', 'Tekrar'))],
    }, { signal }))
  .component('again', (interaction, signal) =>
    client.interactions.update(interaction, { content: 'tekrar pong', components: [] }, { signal }));

const events = new EventMux();
events.on('INTERACTION_CREATE', (interaction, event, signal) => router.handle(interaction, signal));

const stop = new AbortController();
process.once('SIGINT', () => stop.abort());
await client.newSession({ handler: events.handle }).run({ signal: stop.signal });
```

`client.newSession().run()` geri çekilmeyle yeniden bağlanır ve en son işlenen sıradan devam eder. Başarısız bir işleyici aynı olayı yeniden alabilir; dışarıdan görünen işlemleri tekrarlanabilir yazın.

## İçinde neler var

| Alan | Ne sağlar | Başlangıç |
| --- | --- | --- |
| İstemci | Hız sınırı beklemeli, yeniden denemeli, denetim kaydı sebepli, `AbortSignal` destekli REST; bot kimliği (`self`, `application()`, `tokenId`) | `MicupClient` |
| Gateway | Resume, kalp atışı denetimi, Zstandard sıkıştırma, durum (presence), tembel abonelikler, üye envanteri ve sayımlar içeren denetlenen oturumlar | `client.newSession()` |
| Shard | IDENTIFY'ları aralıklayan, sunucuları shard'lara yönlendiren ve shard sayısı öneren yönetici | `client.newShardManager()` |
| Durum | Sunucu, kanal, thread, üye, rol ve ses durumu önbelleği; izin ve rol hiyerarşisi kontrolleri | `session.state` |
| Komutlar ve etkileşimler | Slash ve bağlam menüsü komutları, otomatik tamamlama, butonlar, seçim menüleri, modallar, ertelenmiş ve gizli yanıtlar, takip mesajları, isme göre yönlendirme | `client.commands`, `client.interactions`, `InteractionRouter` |
| Mesajlar | Gönderme, düzenleme, yanıt, iletme, yayınlama, arama, toplu silme, embed, doğrudan yükleme, embed gizleme, tepki, sabitleme | `client.sendMessage()`, `client.channels`, `client.attachments` |
| Sunucu yönetimi | Sunucu, üye, rol, ban, zaman aşımı, denetim kaydı, özel davet adresi, kanal düzeni, davetler, thread ve forum, webhook | `client.guilds`, `client.channels`, `client.webhooks` |
| İfadeler | Emoji ve çıkartma listeleme, oluşturma, kopyalama, toplu oluşturma | `client.expressions` |
| Ses efektleri | Soundboard sesleri, ses kanalında çalma, sunucu ve kanal bildirim sesleri | `client.sounds` |
| Ses odaları | 3D oda sahnesi (oda TV'sinde pano veya video, host, efektler) ve oda turnuvaları | `client.rooms` |
| Keşif | Sunucu keşif kaydını okuma, başvuru, düzenleme ve geri çekme | `client.discovery` |
| Olaylar | Tipli Gateway olay kataloğu, olay çoklayıcı ve işleyici sarmalayıcıları | `EventMux`, `knownGatewayEvents`, `safeHandler()` |
| Yardımcılar | Sabit grupları, buton ve seçim menüsü oluşturucular, komut seçeneği okuyucuları, izin yardımcıları, etiketleme, zaman damgası, snowflake, yerelleştirilmiş mesaj kataloğu | `ChannelType`, `primaryButton()`, `optionString()`, `permissionNames()` |
| Ses çalma | FFmpeg çözmeli LiveKit sesi, PCM oynatıcı ve olay yayan bağlantı nesnesi | [`@micup.ts/voice`](packages/voice) |

Her çağrı isteğe bağlı `AbortSignal` alır. HTTP hataları `status`, `code`, alan hataları, `retryAfter` ve `notFound`, `rateLimited`, `hasFieldCode()` gibi yardımcılarla `MicupAPIError` olarak gelir. Hata kodlarının adları `MicupErrorCode` içindedir.

## Daha fazla örnek

Komut seçeneğini okuma ve modal açma:

```js
import { modalRows, optionString, shortInput } from 'micup.ts';

router.command('merhaba', async (interaction, signal) => {
  const name = optionString(interaction.data, 'isim') ?? 'dostum';
  await client.interactions.respond(interaction, `Merhaba ${name}`, { ephemeral: true, signal });
});

router.command('geri-bildirim', (interaction, signal) =>
  client.interactions.modal(interaction, {
    title: 'Geri bildirim',
    custom_id: 'feedback',
    components: modalRows(shortInput('subject', 'Konu')),
  }, { signal }));
```

Birden çok shard çalıştırma ve yavaş işi Gateway işleyicisinden ayırma:

```js
import { background } from 'micup.ts';

const manager = client.newShardManager({
  shardCount: await client.recommendedShards(),
  session: { handler: events.handle, compress: true, trackMembers: true },
});
void background(async (signal) => { await slowSearch(signal); }, { timeoutMs: 30_000, name: 'search' });
await manager.run({ signal: stop.signal });
```

Botun izni olmadığı için başarısız olan istekleri, rota başına dakikada en fazla bir kez günlüğe yazma:

```js
const client = await MicupClient.connect({
  token: process.env.MICUP_BOT_TOKEN,
  logger: { warn: (message, fields) => console.warn(message, fields) },
});
```

## Ses

[`@micup.ts/voice`](packages/voice) sesi LiveKit üzerinden ses kanalına yayınlar. `VoiceConnection` kanala girer; dosya, URL, akış veya ham PCM çalar ve `start`, `finish`, `status`, `memberJoin`, `memberLeave`, `disconnect`, `error` olaylarını yayar. `npm install @micup.ts/voice` ile kurun; dosya ve akışları çözmek için FFmpeg kurun.

## Dokümantasyon

- [Başlangıç](docs/getting-started.md): token, davet bağlantısı, ilk bot, proje düzeni
- [Komutlar ve etkileşimler](docs/commands-and-interactions.md)
- [Gateway ve shard](docs/gateway-and-sharding.md)
- [REST başvurusu](docs/rest-reference.md)
- [Ses](docs/voice.md)
- [Hatalar ve sınırlar](docs/errors-and-limits.md)
- [Geçiş rehberi](docs/migrating.md): micup.js, micup.gg.js veya discord.js'ten

Dokümanlar İngilizcedir.

## Güvenilirlik

Test paketi SDK'yı sahte sunucular ve yerel bir LiveKit odasına karşı çalıştırır. Sürümler ayrıca canlı bir botla Micup servisine karşı uçtan uca denenir: komutlar, otomatik tamamlama, butonlar, seçim menüleri, modallar, ertelenmiş ve gizli yanıtlar, REST kaynakları ve ses çalma.

İki çalışma alanını yerelde doğrulamak için bir kez `npm ci`, ardından `npm test` çalıştırın.

MIT lisansı. Bkz. [LICENSE](LICENSE).
