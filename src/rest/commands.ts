import { CommandType, type CommandDefinition, type CommandOption, type MicupCommand } from '../model/interaction.js';
import { isLocaleTag } from '../model/locale.js';
import { snowflake } from './messages.js';
import type { MicupRequestOptions, RestTransport } from './transport.js';

const chatName = /^[-_\p{Ll}\p{Lo}\p{N}]{1,32}$/u;
const lengthWithin = (value: string | undefined, limit: number) => Boolean(value && [...value].length <= limit);

function validateLocalizations(values: Readonly<Record<string, string>> | undefined, validate: (text: string) => boolean): void {
  for (const [locale, text] of Object.entries(values ?? {})) {
    if (!isLocaleTag(locale) || !validate(text)) throw new TypeError('Invalid command localization: ' + locale);
  }
}

function validateOptions(options: readonly CommandOption[], depth: number, group = false): void {
  if (options.length > 25) throw new RangeError('A command can contain at most 25 options per level');
  const names = new Set<string>();
  let optional = false;
  const nested = options.some((option) => option.type === 1 || option.type === 2);
  for (const option of options) {
    const structural = option.type === 1 || option.type === 2;
    if (!chatName.test(option.name) || names.has(option.name) || !lengthWithin(option.description, 100)) {
      throw new TypeError('Invalid or duplicate Micup command option: ' + option.name);
    }
    names.add(option.name);
    validateLocalizations(option.name_localizations, (name) => chatName.test(name));
    validateLocalizations(option.description_localizations, (text) => lengthWithin(text, 100));
    if (!Number.isInteger(option.type) || option.type < 1 || option.type > 11 ||
        (nested && !structural) || (group && option.type !== 1)) {
      throw new TypeError('Invalid Micup option structure');
    }
    if (structural) {
      if (option.required || (option.type === 2 ? depth !== 0 || !option.options?.length : depth > 1) ||
          (depth > 0 && !group)) throw new TypeError('Invalid nested Micup command');
      validateOptions(option.options ?? [], depth + 1, option.type === 2);
      continue;
    }
    if (option.options?.length || (option.required && optional) ||
        (option.choices?.length ?? 0) > 25 || (option.autocomplete && option.choices?.length)) {
      throw new TypeError('Invalid Micup command option ordering or choices');
    }
    if (option.autocomplete || option.choices?.length) {
      if (![3, 4, 10].includes(option.type)) throw new TypeError('Invalid Micup choice or autocomplete option type');
      for (const choice of option.choices ?? []) {
        const validValue = option.type === 3
          ? typeof choice.value === 'string' && lengthWithin(choice.value, 100)
          : typeof choice.value === 'number' && Number.isFinite(choice.value) &&
            (option.type !== 4 || Number.isSafeInteger(choice.value));
        validateLocalizations(choice.name_localizations, (text) => lengthWithin(text, 100));
        if (!lengthWithin(choice.name, 100) || !validValue) throw new TypeError('Invalid Micup command choice');
      }
    }
    if (!option.required) optional = true;
  }
}

function commandBody(command: CommandDefinition): CommandDefinition {
  const type = command.type ?? CommandType.ChatInput;
  const { name, description, options, name_localizations, description_localizations, default_member_permissions, dm_permission } = command;
  if (type === CommandType.ChatInput) {
    if (!chatName.test(name) || !lengthWithin(description, 100)) throw new TypeError('Invalid Micup command name or description');
    validateLocalizations(name_localizations, (text) => chatName.test(text));
    validateLocalizations(description_localizations, (text) => lengthWithin(text, 100));
    validateOptions(options ?? [], 0);
  } else if ((type !== CommandType.User && type !== CommandType.Message) ||
      !lengthWithin(name, 32) || description || options?.length) {
    throw new TypeError('Invalid Micup context menu command');
  }
  if (type !== CommandType.ChatInput) validateLocalizations(name_localizations, (text) => lengthWithin(text, 32));
  return { type, name, description, options, name_localizations, description_localizations, default_member_permissions, dm_permission };
}

export interface CommandScope extends MicupRequestOptions {
  guildId?: string;
  applicationId?: string;
}

export class MicupCommands {
  constructor(private readonly rest: RestTransport, private readonly botId: string) {}

  #path({ guildId, applicationId = this.botId }: CommandScope, commandId?: string): string {
    const application = '/applications/' + snowflake(applicationId, 'Application ID');
    const scope = guildId === undefined ? application : application + '/guilds/' + snowflake(guildId, 'Guild ID');
    return scope + '/commands' + (commandId === undefined ? '' : '/' + snowflake(commandId, 'Command ID'));
  }

  list(scope: CommandScope = {}): Promise<MicupCommand[]> {
    return this.rest.request('GET', this.#path(scope), scope);
  }

  get(id: string, scope: CommandScope = {}): Promise<MicupCommand> {
    return this.rest.request('GET', this.#path(scope, id), scope);
  }

  create(command: CommandDefinition, scope: CommandScope = {}): Promise<MicupCommand> {
    return this.rest.request('POST', this.#path(scope), { ...scope, body: commandBody(command) });
  }

  edit(id: string, command: Partial<CommandDefinition>, scope: CommandScope = {}): Promise<MicupCommand> {
    return this.rest.request('PATCH', this.#path(scope, id), { ...scope, body: command });
  }

  delete(id: string, scope: CommandScope = {}): Promise<void> {
    return this.rest.request('DELETE', this.#path(scope, id), scope);
  }

  set(commands: readonly CommandDefinition[], scope: CommandScope = {}): Promise<MicupCommand[]> {
    if (commands.length > 100) throw new RangeError('Micup accepts up to 100 commands per scope');
    return this.rest.request('PUT', this.#path(scope), { ...scope, body: commands.map(commandBody) });
  }
}
