import { CommandOptionType, CommandType, type CommandChoice, type CommandDefinition, type CommandOption } from '../model/interaction.js';
import { modalRows } from '../model/components.js';
import type { TextInput } from '../model/components.js';
import type { MicupModal } from '../rest/interactions.js';
import type { MessageCatalog } from '../model/locale.js';
import { localizeCommand, type LocalizeOptions } from '../model/localize.js';

type Localizations = Readonly<Record<string, string>>;

export interface OptionConfig {
  required?: boolean;
  nameLocalizations?: Localizations;
  descriptionLocalizations?: Localizations;
}

export interface StringOptionConfig extends OptionConfig {
  choices?: readonly (CommandChoice | string)[];
  autocomplete?: boolean;
  minLength?: number;
  maxLength?: number;
}

export interface NumberOptionConfig extends OptionConfig {
  choices?: readonly (CommandChoice | number)[];
  autocomplete?: boolean;
  minValue?: number;
  maxValue?: number;
}

export interface ChannelOptionConfig extends OptionConfig {
  channelTypes?: readonly number[];
}

function build(type: number, name: string, description: string, config: OptionConfig = {}): CommandOption {
  return {
    type, name, description,
    ...(config.required && { required: true }),
    ...(config.nameLocalizations && { name_localizations: config.nameLocalizations }),
    ...(config.descriptionLocalizations && { description_localizations: config.descriptionLocalizations }),
  };
}

function stringChoices(values: StringOptionConfig['choices']): CommandChoice[] | undefined {
  if (values === undefined) return undefined;
  if (!Array.isArray(values)) throw new TypeError('String command choices must be an array');
  return Array.from(values, (choice) => {
    if (typeof choice === 'string') return { name: choice, value: choice };
    if (!choice || typeof choice !== 'object') throw new TypeError('String command choices must be strings or choice objects');
    return choice;
  });
}

function numberChoices(values: NumberOptionConfig['choices']): CommandChoice[] | undefined {
  if (values === undefined) return undefined;
  if (!Array.isArray(values)) throw new TypeError('Numeric command choices must be an array');
  return Array.from(values, (choice) => {
    if (typeof choice === 'number') return { name: String(choice), value: choice };
    if (!choice || typeof choice !== 'object') throw new TypeError('Numeric command choices must be numbers or choice objects');
    return choice;
  });
}

export class OptionList {
  protected readonly options: CommandOption[] = [];

  protected push(option: CommandOption): this {
    if (this.options.some((existing) => existing.name === option.name)) throw new TypeError('Duplicate command option: ' + option.name);
    this.options.push(option);
    return this;
  }

  addString(name: string, description: string, config: StringOptionConfig = {}): this {
    const choices = stringChoices(config.choices);
    return this.push({
      ...build(CommandOptionType.String, name, description, config),
      ...(choices?.length && { choices }),
      ...(config.autocomplete && { autocomplete: true }),
      ...(config.minLength !== undefined && { min_length: config.minLength }),
      ...(config.maxLength !== undefined && { max_length: config.maxLength }),
    });
  }

  addInteger(name: string, description: string, config: NumberOptionConfig = {}): this {
    return this.#number(CommandOptionType.Integer, name, description, config);
  }

  addNumber(name: string, description: string, config: NumberOptionConfig = {}): this {
    return this.#number(CommandOptionType.Number, name, description, config);
  }

  addBoolean(name: string, description: string, config: OptionConfig = {}): this {
    return this.push(build(CommandOptionType.Boolean, name, description, config));
  }

  addUser(name: string, description: string, config: OptionConfig = {}): this {
    return this.push(build(CommandOptionType.User, name, description, config));
  }

  addRole(name: string, description: string, config: OptionConfig = {}): this {
    return this.push(build(CommandOptionType.Role, name, description, config));
  }

  addMentionable(name: string, description: string, config: OptionConfig = {}): this {
    return this.push(build(CommandOptionType.Mentionable, name, description, config));
  }

  addAttachment(name: string, description: string, config: OptionConfig = {}): this {
    return this.push(build(CommandOptionType.Attachment, name, description, config));
  }

  addChannel(name: string, description: string, config: ChannelOptionConfig = {}): this {
    if (config.channelTypes !== undefined && !Array.isArray(config.channelTypes)) throw new TypeError('Channel types must be an array');
    const channelTypes = config.channelTypes === undefined ? undefined : Array.from(config.channelTypes, (type) => {
      if (!Number.isSafeInteger(type) || type < 0) throw new TypeError('Channel types must be nonnegative integers');
      return type;
    });
    return this.push({
      ...build(CommandOptionType.Channel, name, description, config),
      ...(channelTypes?.length && { channel_types: channelTypes }),
    });
  }

  protected buildOptions(): CommandOption[] {
    return [...this.options.filter((option) => option.required), ...this.options.filter((option) => !option.required)];
  }

  #number(type: number, name: string, description: string, config: NumberOptionConfig): this {
    const choices = numberChoices(config.choices);
    return this.push({
      ...build(type, name, description, config),
      ...(choices?.length && { choices }),
      ...(config.autocomplete && { autocomplete: true }),
      ...(config.minValue !== undefined && { min_value: config.minValue }),
      ...(config.maxValue !== undefined && { max_value: config.maxValue }),
    });
  }
}

export class Subcommand extends OptionList {
  constructor(readonly name: string, readonly description: string) {
    super();
  }

  toJSON(): CommandOption {
    const options = this.buildOptions();
    return { type: CommandOptionType.Subcommand, name: this.name, description: this.description, ...(options.length && { options }) };
  }
}

export class SubcommandGroup {
  readonly #subcommands: Subcommand[] = [];

  constructor(readonly name: string, readonly description: string) {}

  addSubcommand(name: string, description: string, configure?: (subcommand: Subcommand) => unknown): this {
    const subcommand = new Subcommand(name, description);
    configure?.(subcommand);
    this.#subcommands.push(subcommand);
    return this;
  }

  toJSON(): CommandOption {
    return { type: CommandOptionType.SubcommandGroup, name: this.name, description: this.description, options: this.#subcommands.map((subcommand) => subcommand.toJSON()) };
  }
}

export class SlashCommand extends OptionList {
  readonly #children: (Subcommand | SubcommandGroup)[] = [];
  #nameLocalizations?: Localizations;
  #descriptionLocalizations?: Localizations;
  #permissions?: bigint;
  #dm?: boolean;
  #localization?: { catalog: MessageCatalog; options: LocalizeOptions };

  constructor(readonly name: string, readonly description: string) {
    super();
  }

  setNameLocalizations(localizations: Localizations): this {
    this.#nameLocalizations = localizations;
    return this;
  }

  setDescriptionLocalizations(localizations: Localizations): this {
    this.#descriptionLocalizations = localizations;
    return this;
  }

  localize(catalog: MessageCatalog, options: LocalizeOptions = {}): this {
    this.#localization = { catalog, options };
    return this;
  }

  setDefaultMemberPermissions(permissions: bigint | null): this {
    if (permissions !== null && (typeof permissions !== 'bigint' || permissions < 0n)) {
      throw new TypeError('Default member permissions must be a nonnegative bigint or null');
    }
    this.#permissions = permissions ?? undefined;
    return this;
  }

  setDMPermission(allowed: boolean): this {
    this.#dm = allowed;
    return this;
  }

  addSubcommand(name: string, description: string, configure?: (subcommand: Subcommand) => unknown): this {
    const subcommand = new Subcommand(name, description);
    configure?.(subcommand);
    this.#children.push(subcommand);
    return this;
  }

  addSubcommandGroup(name: string, description: string, configure?: (group: SubcommandGroup) => unknown): this {
    const group = new SubcommandGroup(name, description);
    configure?.(group);
    this.#children.push(group);
    return this;
  }

  toJSON(): CommandDefinition {
    const direct = this.buildOptions();
    if (direct.length && this.#children.length) throw new TypeError('A command takes options or subcommands, not both: ' + this.name);
    const options = this.#children.length ? this.#children.map((child) => child.toJSON()) : direct;
    const definition: CommandDefinition = {
      name: this.name,
      description: this.description,
      type: CommandType.ChatInput,
      ...(options.length && { options }),
      ...(this.#nameLocalizations && { name_localizations: this.#nameLocalizations }),
      ...(this.#descriptionLocalizations && { description_localizations: this.#descriptionLocalizations }),
      ...(this.#permissions !== undefined && { default_member_permissions: String(this.#permissions) }),
      ...(this.#dm !== undefined && { dm_permission: this.#dm }),
    };
    return this.#localization ? localizeCommand(definition, this.#localization.catalog, this.#localization.options) : definition;
  }
}

export function userCommand(name: string): CommandDefinition {
  return { name, type: CommandType.User };
}

export function messageCommand(name: string): CommandDefinition {
  return { name, type: CommandType.Message };
}

export function modal(customId: string, title: string, ...inputs: readonly TextInput[]): MicupModal {
  return { custom_id: customId, title, components: modalRows(...inputs) };
}
