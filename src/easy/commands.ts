import { CommandOptionType, CommandType, type CommandChoice, type CommandDefinition, type CommandOption } from '../model/interaction.js';
import { modalRows } from '../model/components.js';
import type { TextInput } from '../model/components.js';
import type { MicupModal } from '../rest/interactions.js';

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

export class OptionList {
  protected readonly options: CommandOption[] = [];

  protected push(option: CommandOption): this {
    if (this.options.some((existing) => existing.name === option.name)) throw new TypeError('Duplicate command option: ' + option.name);
    this.options.push(option);
    return this;
  }

  addString(name: string, description: string, config: StringOptionConfig = {}): this {
    const choices = config.choices?.map((choice): CommandChoice => typeof choice === 'string' ? { name: choice, value: choice } : choice);
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
    return this.push({
      ...build(CommandOptionType.Channel, name, description, config),
      ...(config.channelTypes?.length && { channel_types: config.channelTypes }),
    });
  }

  protected buildOptions(): CommandOption[] {
    return [...this.options.filter((option) => option.required), ...this.options.filter((option) => !option.required)];
  }

  #number(type: number, name: string, description: string, config: NumberOptionConfig): this {
    const choices = config.choices?.map((choice): CommandChoice => typeof choice === 'number' ? { name: String(choice), value: choice } : choice);
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

  setDefaultMemberPermissions(permissions: bigint | null): this {
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
    return {
      name: this.name,
      description: this.description,
      type: CommandType.ChatInput,
      ...(options.length && { options }),
      ...(this.#nameLocalizations && { name_localizations: this.#nameLocalizations }),
      ...(this.#descriptionLocalizations && { description_localizations: this.#descriptionLocalizations }),
      ...(this.#permissions !== undefined && { default_member_permissions: String(this.#permissions) }),
      ...(this.#dm !== undefined && { dm_permission: this.#dm }),
    };
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
