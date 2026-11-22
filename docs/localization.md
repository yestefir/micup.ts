# Localization

Micup shows a bot's slash commands and replies in the language of each user. micup.ts gives you one place for all texts, a catalog, and uses it for both: it fills the translations of your commands, and it answers each interaction in the language of the person who ran it.

## What Micup does with languages

- Every interaction carries `locale`, the language of the user who ran it (for example `tr`), and `guild_locale`. Use `locale`.
- A command, its options and its choices can carry translated names and descriptions (`name_localizations`, `description_localizations`). Micup stores them and shows each user the translation for their language, with the default text for languages you did not translate. Choices have translated names only.
- Replies, errors, select option labels and everything else you send are your own text: translate them yourself with the catalog below. Translate error messages too, not only the success path.
- Micup decides which language codes it accepts and rejects an unknown one. The SDK checks only that a key looks like a language tag (`tr`, `en-US`) and does not carry a list of codes, so use the codes Micup documents.
- Translated names count as names: two commands of the same type cannot share a name in any language.

## The message catalog

```js
import { MessageCatalog } from 'micup.ts';

const catalog = new MessageCatalog('en-US', {
  'en-US': { 'play.name': 'play', 'play.description': 'Play a song', playing: 'Now playing %s', 'too-short': 'Type at least 3 characters.' },
  tr: { 'play.name': 'oynat', 'play.description': 'Bir şarkı çal', playing: '%s çalınıyor', 'too-short': 'En az 3 karakter yaz.' },
});
```

The fallback locale holds every message. Other locales translate any subset, and a key missing from a locale falls back to the fallback text. The constructor throws when the fallback has no messages, when a locale is not a language tag, when a locale is listed twice, or when another locale has a key the fallback lacks (usually a typo).

| Member | Behavior |
| --- | --- |
| `text(interaction, key, ...values)` | the message in the interaction's `locale`, or its `guild_locale` when `locale` is empty |
| `textIn(locale, key, ...values)` | the same for a locale you already hold |
| `localizations(key)` | a `locale → text` map of every translation except the fallback's, for the localization fields of a command |
| `resolve(locale)` | the catalog locale that serves a locale, or `undefined` |
| `has(key)` | whether the fallback locale has the key |
| `fallback`, `locales` | the fallback locale and every locale, sorted |

Values are formatted like `util.format` (`%s`, `%d`, `%j`). Locales match without regard to case, and `_` equals `-`: `tr_TR` and `TR` find `tr`, `pt` finds `pt-BR` when no plain `pt` exists, and `en-GB` finds `en`. A locale with no match and an unknown key give the fallback text and the key itself, so a missing translation shows up as a visible key.

## Translate commands from the catalog

`localizeCommand(command, catalog)` returns a copy of a command with translations taken from catalog keys. The keys follow the path of what you translate:

| Text | Key |
| --- | --- |
| command name, description | `play.name`, `play.description` |
| option name, description | `play.query.name`, `play.query.description` |
| choice name (by value) | `play.mode.choice.loop` |
| subcommand group, subcommand, option | `play.queue.add.name`, `play.queue.add.limit.description` |
| context menu command name | `Quote.name` |

```js
import { SlashCommand, localizeCommand } from 'micup.ts/easy';

const play = new SlashCommand('play', 'Play a song')
  .addString('query', 'Song name or link', { required: true })
  .addString('mode', 'Mode', { choices: [{ name: 'Loop', value: 'loop' }, 'once'] })
  .toJSON();

await client.rest.commands.create(localizeCommand(play, catalog), { guildId });
```

Only keys the catalog has for another locale are added; translations you set on the command yourself win. `localizeCommand(command, catalog, { prefix: 'player' })` changes the root of the keys (the command name by default), `{ strict: true }` throws when a default text differs from the fallback message of its key (a drift check), and `localizeCommands(list, catalog)` handles several commands. The command you pass is not modified.

Before a command is sent the SDK checks every translation with the same limits as the original: names of 1 to 32 lowercase letters, digits, `-` or `_` (context menu names up to 32 characters), descriptions of 1 to 100 characters, and language-tag keys. The error says which command, option or choice is wrong. Empty translation maps are dropped, and `commands.set()` refuses a set in which names collide once translated.

## With the easy client

Give the client the catalog and everything is wired:

```js
import { Client, SlashCommand } from 'micup.ts/easy';

const client = new Client({ catalog });

client.command(new SlashCommand('play', 'Play a song').addString('query', 'Song name or link', { required: true }), async (interaction) => {
  const query = interaction.options.getString('query', true);
  if (query.length < 3) return interaction.reply({ content: interaction.t('too-short'), ephemeral: true });
  await interaction.reply(interaction.t('playing', query));
});

await client.login();
```

- At login the client translates every command you defined from the catalog before it registers it. It also compares translations: change a text in the catalog and the next start edits the command. Turn this off with `localizeCommands: false`, or add `strictLocalization: true` for the drift check.
- `interaction.t(key, ...values)` answers in the language of the user. `interaction.text(otherCatalog, key)` and `client.text(locale, key)` do the same with another catalog or a locale you hold.
- When the catalog has the key `error.generic`, it is the private error message a failed handler sends in the user's language.
- `new SlashCommand(...).localize(catalog)` localizes one command on its own, with the same key rules.

## Tips

- Keep one catalog per bot and keys in dotted groups (`play.name`, `queue.empty`).
- Do not translate `custom_id`s or command names you route on: the router matches the default name (`play`) in every language.
- Autocomplete choices are not translated by Micup because you create them per request: build them with `interaction.t()`.
- In a message you send without an interaction (a scheduled reminder, for example) use `catalog.textIn(locale, key)` with a locale you stored for the user, or the fallback.
