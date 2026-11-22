# micup.ts

[Micup](https://micup.gg) botları için TypeScript SDK'sı. Botu Micup Gateway ve REST API'sine yeniden bağlanma, oturum sürdürme (resume), shard desteği, hız sınırı yönetimi ve tam tip tanımlarıyla bağlar. Slash komutları, butonlar, seçim menüleri, modallar, soundboard, ses odaları ve ses çalmayı kapsar.

[English README](README.md) · [Dokümantasyon](docs/README.md) · [Değişiklik günlüğü](CHANGELOG.md)

```sh
npm install micup.ts
```

Node.js 20.3 veya üstü ve bir Micup bot token'ı gerekir (Zstandard Gateway sıkıştırması için 22.15). Üretimdeki botları çalıştıran Go kütüphanesi [micup.go](https://github.com/yestefir/micup.go) temel alınmıştır.

## Hızlı başlangıç

Kolay istemci, çalışan bir bota giden en kısa yoldur. `MICUP_BOT_TOKEN` değişkenini ayarlayıp çalıştırın:

```js
import { Client, SlashCommand, actionRow, primaryButton } from 'micup.ts/easy';

const client = new Client();

client.on('messageCreate', async (message) => {
  if (message.author.bot || message.content !== '!ping') return;
  await message.reply('pong');
});

client.command(new SlashCommand('merhaba', 'Selam ver').addString('isim', 'Kime selam verilecek'), async (interaction) => {
  const name = interaction.options.getString('isim') ?? interaction.user.displayName;
  await interaction.reply({ content: `Merhaba ${name}!`, components: [actionRow(primaryButton('again', 'Tekrar'))] });
});

client.component('again', (interaction) => interaction.update({ content: 'Tekrar merhaba!', components: [] }));

await client.login();
```

`login()` bağlanır, sunucularınızı bekler, `merhaba` komutunu kaydeder ve yönlendirmeyi başlatır. İşleyicilerinizdeki hatalar botu çökertmez: `error` olayı olarak yayılır ve yanıtlamadan başarısız olan komut kullanıcıya gizli bir hata yanıtı alır. Bkz. [Kolay istemci](docs/easy-client.md) (İngilizce).

Oturumlar, shard'lar ve işleyici yeniden denemeleri üzerinde tam denetim için çekirdek API'yi kullanın:

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
| Kolay istemci | Olaylar, `message.reply()`, `interaction.reply()`, slash komutu oluşturucu, otomatik komut kaydı ve yönlendirme, butonlar, menüler, modallar, otomatik tamamlama, sayfalama ve güvenli hata yönetimi sunan `Client` | `micup.ts/easy` |
| İstemci | Hız sınırı beklemeli, yeniden denemeli, denetim kaydı sebepli, `AbortSignal` destekli REST; bot kimliği (`self`, `application()`, `tokenId`) | `MicupClient` |
| Gateway | Resume, kalp atışı denetimi, Zstandard sıkıştırma, durum (presence), tembel abonelikler, üye envanteri ve sayımlar içeren denetlenen oturumlar | `client.newSession()` |
| Shard | IDENTIFY'ları aralıklayan, sunucuları shard'lara yönlendiren ve shard sayısı öneren yönetici | `client.newShardManager()` |
| Durum | Sunucu, kanal, thread, üye, rol ve ses durumu önbelleği; izin ve rol hiyerarşisi kontrolleri | `session.state` |
| Komutlar ve etkileşimler | Slash ve bağlam menüsü komutları, otomatik tamamlama, butonlar, seçim menüleri, modallar, ertelenmiş ve gizli yanıtlar, takip mesajları, isme göre yönlendirme | `client.commands`, `client.interactions`, `InteractionRouter` |
| Mesajlar | Gönderme, düzenleme, yanıt, iletme, yayınlama, arama, toplu silme, embed, doğrudan yükleme, embed gizleme, tepki, sabitleme | `client.sendMessage()`, `client.channels`, `client.attachments` |
| Sunucu yönetimi | Sunucu, üye, rol, ban, zaman aşımı, denetim kaydı, özel davet adresi, kanal düzeni, davetler, thread ve forum, webhook | `client.guilds`, `client.channels`, `client.webhooks` |
| İfadeler | Emoji ve çıkartma listeleme, oluşturma, kopyalama, toplu oluşturma, düzenleme, silme ve metadata | `client.expressions` |
| Ses efektleri | Soundboard sesleri, ses kanalında çalma, sunucu ve kanal bildirim sesleri | `client.sounds` |
| Ses odaları | 3D oda sahnesi (oda TV'sinde pano veya video, host, efektler) ve oda turnuvaları | `client.rooms` |
| Keşif | Sunucu keşif kaydını okuma, başvuru, düzenleme ve geri çekme | `client.discovery` |
| Olaylar | Tipli Gateway olay kataloğu, olay çoklayıcı ve işleyici sarmalayıcıları | `EventMux`, `knownGatewayEvents`, `safeHandler()` |
| Yerelleştirme | Her kullanıcıya kendi dilinde yanıt veren ve komut adlarını, açıklamalarını, seçeneklerini ve seçimlerini aynı katalogdan çeviren mesaj kataloğu (`localizeCommand()`, `Client({ catalog })`, `interaction.t()`) | [Yerelleştirme](docs/localization.md) (İngilizce) |
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

Botun izni olmadığı için başarısız olan istekleri, rota başına dakikada en fazla bir kez günlüğe yazma (oturumlar bağlanma, resume ve kopmalar için aynı `logger` seçeneğini alır):

```js
const client = await MicupClient.connect({
  token: process.env.MICUP_BOT_TOKEN,
  logger: { warn: (message, fields) => console.warn(message, fields) },
});
```

## Ses

[`@micup.ts/voice`](packages/voice) sesi LiveKit üzerinden ses kanalına yayınlar. `VoiceConnection` kanala girer; dosya, URL, akış veya ham PCM çalar ve `start`, `finish`, `status`, `memberJoin`, `memberLeave`, `disconnect`, `error` olaylarını yayar. `npm install @micup.ts/voice` ile kurun; dosya ve akışları çözmek için FFmpeg kurun.

## Onaylı bot

Micup'ta onaylı bot olmak için üç zorunlu şart vardır ve bunların üçü de modül tarafından yerine getirilmiştir: rate-limit kurallarına tamamen uygundur, DM spam kurallarına tamamen uygundur, komut yerelleştirme kurallarına tamamen uygundur.

| Şart | micup.ts ne yapar |
| --- | --- |
| Rate-limit | REST isteklerini Micup'un gönderdiği başlık ve gövdelere göre hızlandırır ve yeniden dener (rota kovaları, `retry_after`, genel kova), her Gateway komutunu bütçesi içinde tutar ve Micup'un reddettiği istekleri tekrarlamayı bırakır |
| DM spam | kendiliğinden hiç DM göndermez, DM kotasını yalnızca 30 saniye içinde açılıyorsa bekler ve spam engelini asla yeniden denemez (`NEW_DM_RATE_LIMITED`, `SPAM_BLOCKED`) |
| Komut yerelleştirme | komut adlarını, açıklamalarını, seçeneklerini ve seçimlerini tek katalogdan çevirir ve her etkileşime kullanıcının dilinde yanıt verir |

Botun kime mesaj atacağına ve ne yazacağına yine sizin kodunuz karar verir; SDK hiçbir sınırı aşmaya çalışmaz. Her sınır ve nasıl ele alındığı için [Onaylı botlar](docs/verified-bots.md) (İngilizce) sayfasına bakın.

## Dokümantasyon

- [Kolay istemci](docs/easy-client.md) (İngilizce): `micup.ts/easy`, olaylar, nesneler, komutlar, etkileşimler ve hatalar
- [Başlangıç](docs/getting-started.md): token, davet bağlantısı, ilk bot, proje düzeni
- [Onaylı botlar](docs/verified-bots.md) (İngilizce): rate-limit, DM spam ve yerelleştirme şartlarının nasıl karşılandığı
- [Yerelleştirme](docs/localization.md) (İngilizce): komutları ve yanıtları her kullanıcının diline çevirme
- [Komutlar ve etkileşimler](docs/commands-and-interactions.md)
- [Gateway ve shard](docs/gateway-and-sharding.md)
- [REST başvurusu](docs/rest-reference.md)
- [Ses](docs/voice.md)
- [Hatalar ve sınırlar](docs/errors-and-limits.md)
- [Geçiş rehberi](docs/migrating.md): micup.js, micup.gg.js veya discord.js'ten

Dokümanlar İngilizcedir.

## Güvenilirlik

Test paketi SDK'yı sahte sunucular ve yerel bir LiveKit odasına karşı çalıştırır. `npm run test:live`, `MICUP_TEST_BOT_TOKEN` ve açıkça belirtilmiş `MICUP_TEST_ORIGIN` ile bot kimliğini, uygulama erişimini, sunucu listesini, shard önerisini, botun üye olduğu ilk sunucudaki sunucu/kanal/rol/üye okumalarını ve Gateway el sıkışmasını salt okunur biçimde denetler. Sunucu verisi oluşturmaz veya değiştirmez ve kullanıcı token'ı kabul etmez. Üretim dışı sandbox için `MICUP_TEST_ORIGIN` değerini ayarlayın; adres belirtilmezse test üretime yönelmez.

İki çalışma alanını yerelde doğrulamak için bir kez `npm ci`, ardından `npm test` çalıştırın.

MIT lisansı. Bkz. [LICENSE](LICENSE).
