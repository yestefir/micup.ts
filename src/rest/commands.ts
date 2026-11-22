import { CommandType, type CommandDefinition, type CommandOption, type MicupCommand } from '../model/interaction.js';
import { isLocaleTag } from '../model/locale.js';
import { snowflake } from './messages.js';
import type { MicupRequestOptions, RestTransport } from './transport.js';

const chatName = /^[-_\p{Ll}\p{Lo}\p{N}]{1,32}$/u;
const lengthWithin = (value: string | undefined, limit: number) => Boolean(value && [...value].length <= limit);
const maxPermissionMask = (1n << 64n) - 1n;

function validateDefaultMemberPermissions(value: unknown): void {
  if (value === undefined || value === null) return;
  if (typeof value !== 'string' || !/^\d{1,20}$/.test(value) || BigInt(value) > maxPermissionMask) {
    throw new TypeError('Default member permissions must be an unsigned 64-bit decimal value or null');
  }
}

function validateLocalizations(values: Readonly<Record<string, string>> | undefined, validate: (text: string) => boolean, what: string): void {
  for (const [locale, text] of Object.entries(values ?? {})) {
    if (!isLocaleTag(locale)) throw new TypeError('"' + locale + '" in ' + what + ' is not a language tag such as tr or en-US');
    if (typeof text !== 'string' || !validate(text)) throw new TypeError('Invalid translation "' + String(text) + '" in ' + what + ' for the locale ' + locale);
  }
}

function nonEmpty(values: Readonly<Record<string, string>> | undefined): Readonly<Record<string, string>> | undefined {
  return values && Object.keys(values).length ? values : undefined;
}

function shownNames(command: CommandDefinition): string[] {
  return [command.name, ...Object.values(command.name_localizations ?? {})];
}

export function assertUniqueCommandNames(commands: readonly CommandDefinition[]): void {
  const seen = new Set<string>();
  for (const command of commands) {
    for (const name of new Set(shownNames(command))) {
      const key = (command.type ?? CommandType.ChatInput) + ':' + name;
      if (seen.has(key)) throw new TypeError('Duplicate command name "' + name + '" (translated names count too)');
      seen.add(key);
    }
  }
}

function validateOptions(options: readonly CommandOption[], depth: number, group = false): void {
  if (!Array.isArray(options)) throw new TypeError('Command options must be an array');
  if (options.length > 25) throw new RangeError('A command can contain at most 25 options per level');
  const names = new Set<string>();
  let optional = false;
  const nested = options.some((option) => option.type === 1 || option.type === 2);
  for (const option of options) {
    if (!option || typeof option !== 'object' || Array.isArray(option)) throw new TypeError('Invalid Micup command option');
    const fields = new Set([
      'type', 'name', 'description', 'name_localizations', 'description_localizations', 'required',
      'choices', 'options', 'autocomplete', 'channel_types', 'min_value', 'max_value', 'min_length', 'max_length',
    ]);
    for (const field of Object.keys(option)) {
      if (!fields.has(field)) throw new TypeError(`Command options do not support the ${field} field`);
    }
    const structural = option.type === 1 || option.type === 2;
    if (!chatName.test(option.name) || names.has(option.name) || !lengthWithin(option.description, 100)) {
      throw new TypeError('Invalid or duplicate Micup command option: ' + option.name);
    }
    names.add(option.name);
    validateLocalizations(option.name_localizations, (name) => chatName.test(name), 'the name of option "' + option.name + '"');
    validateLocalizations(option.description_localizations, (text) => lengthWithin(text, 100), 'the description of option "' + option.name + '"');
    if (!Number.isInteger(option.type) || option.type < 1 || option.type > 11 ||
        (nested && !structural) || (group && option.type !== 1)) {
      throw new TypeError('Invalid Micup option structure');
    }
    if (option.required !== undefined && typeof option.required !== 'boolean') throw new TypeError('Command option required must be a boolean');
    if (option.autocomplete !== undefined && typeof option.autocomplete !== 'boolean') throw new TypeError('Command option autocomplete must be a boolean');
    if (option.choices !== undefined && !Array.isArray(option.choices)) throw new TypeError('Command option choices must be an array');
    if (option.channel_types !== undefined) {
      if (option.type !== 7 || !Array.isArray(option.channel_types) ||
          option.channel_types.some((channelType: unknown) => !Number.isSafeInteger(channelType) || (channelType as number) < 0)) {
        throw new TypeError('Channel types require a channel option and nonnegative integer values');
      }
    }
    for (const [field, value] of [['min_value', option.min_value], ['max_value', option.max_value]] as const) {
      if (value !== undefined && (option.type !== 4 && option.type !== 10 || typeof value !== 'number' || !Number.isFinite(value) || option.type === 4 && !Number.isSafeInteger(value))) {
        throw new TypeError(`${field} requires an integer or number option with a finite value`);
      }
    }
    for (const [field, value] of [['min_length', option.min_length], ['max_length', option.max_length]] as const) {
      if (value !== undefined && (option.type !== 3 || !Number.isSafeInteger(value) || value < 0 || value > 6000)) {
        throw new TypeError(`${field} requires a string option and an integer between 0 and 6000`);
      }
    }
    if (option.min_value !== undefined && option.max_value !== undefined && option.min_value > option.max_value) {
      throw new RangeError('Command option minimum value cannot exceed its maximum');
    }
    if (option.min_length !== undefined && option.max_length !== undefined && option.min_length > option.max_length) {
      throw new RangeError('Command option minimum length cannot exceed its maximum');
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
        if (!choice || typeof choice !== 'object' || Array.isArray(choice) ||
            Object.keys(choice).some((field) => !['name', 'value', 'name_localizations'].includes(field))) {
          throw new TypeError('Invalid Micup command choice fields');
        }
        const validValue = option.type === 3
          ? typeof choice.value === 'string' && lengthWithin(choice.value, 100)
          : typeof choice.value === 'number' && Number.isFinite(choice.value) &&
            (option.type !== 4 || Number.isSafeInteger(choice.value));
        validateLocalizations(choice.name_localizations, (text) => lengthWithin(text, 100), 'the choice "' + choice.name + '" of option "' + option.name + '"');
        if (!lengthWithin(choice.name, 100) || !validValue) throw new TypeError('Invalid Micup command choice');
      }
    }
    if (!option.required) optional = true;
  }
}

function commandOptionBody(option: CommandOption): CommandOption {
  const { type, name, description, name_localizations, description_localizations, required, choices, options,
    autocomplete, channel_types, min_value, max_value, min_length, max_length } = option;
  return {
    type,
    name,
    description,
    name_localizations: nonEmpty(name_localizations),
    description_localizations: nonEmpty(description_localizations),
    required,
    choices: choices?.map(({ name: choiceName, value, name_localizations: choiceNames }) => ({
      name: choiceName,
      value,
      name_localizations: nonEmpty(choiceNames),
    })),
    options: options?.map(commandOptionBody),
    autocomplete,
    channel_types,
    min_value,
    max_value,
    min_length,
    max_length,
  };
}

function commandBody(command: CommandDefinition): CommandDefinition {
  if (!command || typeof command !== 'object' || Array.isArray(command)) throw new TypeError('A command definition must be an object');
  const fields = new Set([
    'name', 'type', 'description', 'name_localizations', 'description_localizations', 'options',
    'default_member_permissions', 'dm_permission',
  ]);
  for (const field of Object.keys(command)) {
    if (!fields.has(field)) throw new TypeError(`Command definitions do not support the ${field} field`);
  }
  const type = command.type ?? CommandType.ChatInput;
  const { name, description, options, name_localizations, description_localizations, default_member_permissions, dm_permission } = command;
  validateDefaultMemberPermissions(default_member_permissions);
  if (dm_permission !== undefined && typeof dm_permission !== 'boolean') throw new TypeError('Command dm_permission must be a boolean');
  if (options !== undefined && !Array.isArray(options)) throw new TypeError('Command options must be an array');
  if (type === CommandType.ChatInput) {
    if (!chatName.test(name) || !lengthWithin(description, 100)) throw new TypeError('Invalid Micup command name or description');
    validateLocalizations(name_localizations, (text) => chatName.test(text), 'the name of command "' + name + '"');
    validateLocalizations(description_localizations, (text) => lengthWithin(text, 100), 'the description of command "' + name + '"');
    validateOptions(options ?? [], 0);
  } else if ((type !== CommandType.User && type !== CommandType.Message) ||
      !lengthWithin(name, 32) || description || options?.length) {
    throw new TypeError('Invalid Micup context menu command');
  }
  if (type !== CommandType.ChatInput) validateLocalizations(name_localizations, (text) => lengthWithin(text, 32), 'the name of command "' + name + '"');
  return {
    type, name, description, options: options?.map(commandOptionBody),
    name_localizations: nonEmpty(name_localizations), description_localizations: nonEmpty(description_localizations),
    default_member_permissions, dm_permission,
  };
}

export interface CommandScope extends MicupRequestOptions {
  guildId?: string;
  applicationId?: string;
}

export type CommandEdit = Partial<Pick<CommandDefinition,
  'name' | 'type' | 'description' | 'name_localizations' | 'description_localizations' |
  'options' | 'default_member_permissions' | 'dm_permission'>>;

function commandEditBody(edit: CommandEdit): CommandEdit {
  if (!edit || typeof edit !== 'object' || Array.isArray(edit)) throw new TypeError('A command edit must be an object');
  const allowed = new Set([
    'name', 'type', 'description', 'name_localizations', 'description_localizations',
    'options', 'default_member_permissions', 'dm_permission',
  ]);
  for (const field of Object.keys(edit)) {
    if (!allowed.has(field)) throw new TypeError(`Command updates do not support the ${field} field`);
  }
  if (edit.dm_permission !== undefined && typeof edit.dm_permission !== 'boolean') {
    throw new TypeError('Command dm_permission must be a boolean');
  }
  const type = edit.type ?? CommandType.ChatInput;
  const candidate: CommandDefinition = {
    name: edit.name ?? 'micup',
    ...(type === CommandType.ChatInput ? { description: edit.description ?? 'micup' } : {}),
    ...edit,
    options: edit.options ?? [],
  };
  const validated = commandBody(candidate);
  const body: Partial<CommandDefinition> = {};
  for (const field of Object.keys(edit) as (keyof CommandDefinition)[]) {
    Object.assign(body, { [field]: validated[field] });
  }
  return body;
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

  edit(id: string, command: CommandEdit, scope: CommandScope = {}): Promise<MicupCommand> {
    return this.rest.request('PATCH', this.#path(scope, id), { ...scope, body: commandEditBody(command) });
  }

  delete(id: string, scope: CommandScope = {}): Promise<void> {
    return this.rest.request('DELETE', this.#path(scope, id), scope);
  }

  clear(scope: CommandScope = {}): Promise<void> {
    return this.rest.request('DELETE', this.#path(scope), scope);
  }

  set(commands: readonly CommandDefinition[], scope: CommandScope = {}): Promise<MicupCommand[]> {
    if (commands.length > 100) throw new RangeError('Micup accepts up to 100 commands per scope');
    const body = commands.map(commandBody);
    assertUniqueCommandNames(body);
    return this.rest.request('PUT', this.#path(scope), { ...scope, body });
  }
}
