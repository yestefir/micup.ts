import type { CommandChoice, CommandDefinition, CommandOption } from './interaction.js';
import { CommandType } from './interaction.js';
import type { MessageCatalog } from './locale.js';

export interface LocalizeOptions {
  prefix?: string;
  strict?: boolean;
}

type Texts = Record<string, string>;

export function localizeCommand<T extends CommandDefinition>(command: T, catalog: MessageCatalog, options: LocalizeOptions = {}): T {
  const root = options.prefix ?? command.name;
  const strict = options.strict === true;

  const texts = (key: string, current: string | undefined, existing: Readonly<Texts> | undefined): Texts | undefined => {
    if (strict && catalog.has(key) && current !== undefined && catalog.textIn(catalog.fallback, key) !== current) {
      throw new TypeError('The text "' + current + '" differs from the "' + catalog.fallback + '" catalog message "' + key + '"');
    }
    const merged = { ...catalog.localizations(key), ...existing };
    return Object.keys(merged).length ? merged : undefined;
  };

  const withTexts = <V extends { name: string; description?: string; name_localizations?: Readonly<Texts>; description_localizations?: Readonly<Texts> }>(
    value: V, path: string, describe: boolean,
  ): V => {
    const names = texts(path + '.name', value.name, value.name_localizations);
    const descriptions = describe ? texts(path + '.description', value.description, value.description_localizations) : value.description_localizations;
    return { ...value, ...(names && { name_localizations: names }), ...(descriptions && { description_localizations: descriptions }) };
  };

  const choice = (item: CommandChoice, path: string): CommandChoice => {
    const names = texts(path + '.choice.' + String(item.value), item.name, item.name_localizations);
    return names ? { ...item, name_localizations: names } : item;
  };

  const option = (item: CommandOption, path: string): CommandOption => {
    const here = path + '.' + item.name;
    const localized = withTexts(item, here, true);
    return {
      ...localized,
      ...(item.choices && { choices: Array.from(item.choices, (entry) => choice(entry, here)) }),
      ...(item.options && { options: Array.from(item.options, (child) => option(child, here)) }),
    };
  };

  const chatInput = (command.type ?? CommandType.ChatInput) === CommandType.ChatInput;
  const localized = withTexts(command, root, chatInput);
  return {
    ...localized,
    ...(command.options && { options: Array.from(command.options, (item) => option(item, root)) }),
  } as T;
}

export function localizeCommands<T extends CommandDefinition>(commands: readonly T[], catalog: MessageCatalog, options: Omit<LocalizeOptions, 'prefix'> = {}): T[] {
  return Array.from(commands, (command) => localizeCommand(command, catalog, options));
}
