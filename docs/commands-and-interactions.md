# Commands and interactions

## Register commands

`client.commands` manages the bot's commands. Pass `{ guildId }` for a server scope and omit it for global commands.

| Method | What it does |
| --- | --- |
| `list(scope)`, `get(id, scope)` | read commands |
| `create(definition, scope)` | add one command |
| `edit(id, changes, scope)` | change one command |
| `delete(id, scope)` | remove one command |
| `set(definitions, scope)` | replace the whole set of that scope |
| `clear(scope)` | remove every command of that scope |

`set()` and `clear()` replace or empty the scope, so they also remove commands another process registered. Use `create()` when you only add one.

```js
import { CommandOptionType, CommandType } from 'micup.ts';

await client.commands.create({
  name: 'tool',
  description: 'Small tools',
  type: CommandType.ChatInput,
  options: [
    { type: CommandOptionType.Subcommand, name: 'echo', description: 'Repeat text',
      options: [{ type: CommandOptionType.String, name: 'text', description: 'What to repeat', required: true }] },
    { type: CommandOptionType.Subcommand, name: 'pick', description: 'Pick a fruit',
      options: [{ type: CommandOptionType.String, name: 'fruit', description: 'Fruit', required: true, autocomplete: true }] },
  ],
}, { guildId });
```

Definitions are validated before they are sent (name and option limits, choices, localizations). Context menu commands use `CommandType.User` and `CommandType.Message`. Commands, options and choices can carry translated names and descriptions that Micup shows to each user in their language; build them from a `MessageCatalog` with `localizeCommand()` and translate replies with the same catalog. See [Localization](localization.md).

## Route interactions

```js
import { EventMux, InteractionRouter } from 'micup.ts';

const router = new InteractionRouter()
  .command('tool echo', (interaction, signal) => { /* ... */ })
  .autocomplete('tool pick', (interaction, signal) => { /* ... */ })
  .component('confirm', (interaction, signal) => { /* ... */ })
  .modal('feedback', (interaction, signal) => { /* ... */ });

const events = new EventMux();
events.on('INTERACTION_CREATE', (interaction, event, signal) => router.handle(interaction, signal));
```

Command and autocomplete routes use the command path: the name, then the subcommand group and subcommand separated by spaces. Component and modal routes use the `custom_id`. `router.handle()` resolves to `false` when no route matches.

## Read the input

```js
import { focusedOption, modalValue, optionInteger, optionMember, optionString, selectedUsers, targetUser } from 'micup.ts';

optionString(interaction.data, 'text');        // string | undefined
optionInteger(interaction.data, 'count');
optionMember(interaction.data, 'who');         // resolved member with its user
focusedOption(interaction.data);               // the option being typed in autocomplete
targetUser(interaction.data);                  // user context menu target
modalValue(interaction.data, 'subject');       // text input of a modal submit
selectedUsers(interaction.data);               // resolved users of a user select
```

Related helpers: `optionNumber`, `optionBoolean`, `optionUser`, `optionRole`, `optionChannel`, `optionAttachment`, `commandOption`, `leafOptions`, `targetMessage`, `selectedMembers`, `selectedRoles`, `selectedChannels`, `isButtonInteraction`, `isSelectInteraction`, `interactionCustomId` and `interactionInvoker`.

## Answer

`client.interactions` answers an interaction. Each call takes the interaction and an optional `{ signal }`.

| Method | Use |
| --- | --- |
| `respond(interaction, message, { ephemeral })` | answer with a message; `ephemeral: true` shows it only to the invoker |
| `defer(interaction, { ephemeral })` | acknowledge now and answer later |
| `editResponse(interaction, message)` | edit the first answer or fill a deferred one |
| `followUp(interaction, message, { ephemeral })` | send another message; use it for file uploads |
| `update(interaction, message)` | replace the message that carried the clicked component |
| `deferUpdate(interaction)` | acknowledge a component click without changing the message |
| `modal(interaction, modal)` | open a modal from a command or component |
| `autocomplete(interaction, choices)` | answer an autocomplete request with up to 25 choices |
| `getResponse`, `deleteResponse` | read or delete the first answer |

Answer within three seconds, or defer first; a later first answer fails with `INTERACTION_EXPIRED`. Autocomplete requests cannot be deferred. Interaction replies cannot carry files; attach them in a follow-up after acknowledging.

## Components

```js
import { actionRow, dangerButton, linkButton, primaryButton, selectOption, selectRow, stringSelect, disableButtons } from 'micup.ts';

const components = [
  actionRow(primaryButton('confirm', 'Confirm'), dangerButton('cancel', 'Cancel'), linkButton('https://micup.gg', 'Site')),
  selectRow(stringSelect('color', selectOption('Red', 'red'), selectOption('Blue', 'blue'))),
];
await client.interactions.respond(interaction, { content: 'Choose', components }, { signal });
```

Builders: `primaryButton`, `secondaryButton`, `successButton`, `dangerButton`, `linkButton`, `stringSelect`, `userSelect`, `roleSelect`, `mentionableSelect`, `channelSelect`, `selectOption`, `shortInput`, `paragraphInput`. `disableButtons(rows)` disables buttons and keeps links and selects. A row holds up to five buttons or one select menu.

## Modals

```js
import { modalRows, shortInput, paragraphInput } from 'micup.ts';

await client.interactions.modal(interaction, {
  title: 'Feedback',
  custom_id: 'feedback',
  components: modalRows(shortInput('subject', 'Subject'), paragraphInput('body', 'Details')),
}, { signal });
```

A modal takes one to five text inputs. The submit arrives as an interaction routed by the modal `custom_id`.

## Good to know

- People click buttons and use commands; a bot cannot click a component.
- After a reconnect the Gateway can replay an interaction. A second answer fails with `INTERACTION_TOKEN_CONSUMED`; wrap handlers with `safeHandler()` or catch that code.
- `Components V2` layouts and thread routes depend on the service switches and can answer `403` or `404`.
- Interaction files live for the interaction (15 minutes). Download them if you need them longer.
