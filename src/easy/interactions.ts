import type { MicupMessage } from '../model/entities.js';
import type { MicupChannel, MicupRole } from '../model/guild.js';
import { CommandType, InteractionType, type CommandChoice, type CommandData, type CommandOptionValue, type ComponentData, type MicupInteraction, type ModalData } from '../model/interaction.js';
import { isSelectType, leafOptions } from '../model/helpers.js';
import { ComponentType } from '../model/components.js';
import type { MessageCatalog } from '../model/locale.js';
import type { MicupModal } from '../rest/interactions.js';
import type { MicupRequestOptions } from '../rest/transport.js';
import type { Client } from './client.js';
import { Channel, Guild, Member, Message, User, type MessageContent } from './structures.js';

export class InteractionRepliedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InteractionRepliedError';
  }
}

export interface ReplyOptions {
  ephemeral?: boolean;
  signal?: AbortSignal;
}

export type InteractionContent = MessageContent & { ephemeral?: boolean } | string;

function split(content: InteractionContent, options: ReplyOptions = {}): { message: MessageContent; ephemeral: boolean | undefined; signal: AbortSignal | undefined } {
  if (typeof content === 'string') return { message: content, ephemeral: options.ephemeral, signal: options.signal };
  const { ephemeral, ...message } = content as Exclude<MessageContent, string> & { ephemeral?: boolean };
  return { message, ephemeral: options.ephemeral ?? ephemeral, signal: options.signal };
}

export class Interaction {
  #replied = false;
  #deferred = false;
  readonly user: User;
  readonly member: Member | null;

  constructor(readonly client: Client, readonly raw: MicupInteraction) {
    const user = raw.member?.user ?? raw.user;
    if (!user) throw new Error('The interaction carries no user');
    this.user = new User(client, user);
    this.member = raw.member && raw.guild_id ? new Member(client, { ...raw.member, user }, raw.guild_id) : null;
  }

  get id(): string {
    return this.raw.id;
  }

  get token(): string {
    return this.raw.token;
  }

  get applicationId(): string {
    return this.raw.application_id;
  }

  get type(): number {
    return this.raw.type;
  }

  get guildId(): string | undefined {
    return this.raw.guild_id;
  }

  get channelId(): string | undefined {
    return this.raw.channel_id;
  }

  get locale(): string | undefined {
    return this.raw.locale;
  }

  get guildLocale(): string | undefined {
    return this.raw.guild_locale;
  }

  get appPermissions(): bigint | undefined {
    return this.raw.app_permissions === undefined ? undefined : BigInt(this.raw.app_permissions);
  }

  get channel(): Channel | undefined {
    if (this.raw.channel) return new Channel(this.client, this.raw.channel);
    if (!this.channelId) return undefined;
    return this.client.channels.get(this.channelId) ?? new Channel(this.client, { id: this.channelId, ...(this.guildId && { guild_id: this.guildId }) });
  }

  get guild(): Guild | undefined {
    return this.guildId ? this.client.guilds.get(this.guildId) : undefined;
  }

  get replied(): boolean {
    return this.#replied;
  }

  get deferred(): boolean {
    return this.#deferred;
  }

  get createdAt(): Date {
    return new Date(Number((BigInt(this.id) >> 22n) + 1420070400000n));
  }

  isCommand(): this is CommandInteraction {
    return false;
  }

  isAutocomplete(): this is AutocompleteInteraction {
    return false;
  }

  isComponent(): this is ComponentInteraction {
    return false;
  }

  isButton(): this is ComponentInteraction {
    return false;
  }

  isSelectMenu(): this is ComponentInteraction {
    return false;
  }

  isModalSubmit(): this is ModalSubmitInteraction {
    return false;
  }

  text(catalog: MessageCatalog, key: string, ...values: unknown[]): string {
    return catalog.text(this.raw, key, ...values);
  }

  async reply(content: InteractionContent, options?: ReplyOptions): Promise<void> {
    this.#assertFresh('reply');
    const { message, ephemeral, signal } = split(content, options);
    await this.client.rest.interactions.respond(this.raw, message, { ephemeral, signal });
    this.#replied = true;
  }

  async deferReply(options?: ReplyOptions): Promise<void> {
    this.#assertFresh('defer');
    await this.client.rest.interactions.defer(this.raw, { ephemeral: options?.ephemeral, signal: options?.signal });
    this.#deferred = true;
  }

  async editReply(content: MessageContent, options?: MicupRequestOptions): Promise<Message> {
    this.#assertAnswered('edit the reply of');
    const input = typeof content === 'string' ? { content } : content;
    return new Message(this.client, await this.client.rest.interactions.editResponse(this.raw, input, options));
  }

  async followUp(content: InteractionContent, options?: ReplyOptions): Promise<Message> {
    this.#assertAnswered('follow up');
    const { message, ephemeral, signal } = split(content, options);
    return new Message(this.client, await this.client.rest.interactions.followUp(this.raw, message, { ephemeral, signal }));
  }

  deleteReply(options?: MicupRequestOptions): Promise<void> {
    this.#assertAnswered('delete the reply of');
    return this.client.rest.interactions.deleteResponse(this.raw, options);
  }

  async fetchReply(options?: MicupRequestOptions): Promise<Message> {
    this.#assertAnswered('fetch the reply of');
    return new Message(this.client, await this.client.rest.interactions.getResponse(this.raw, options));
  }

  protected markReplied(): void {
    this.#replied = true;
  }

  protected markDeferred(): void {
    this.#deferred = true;
  }

  protected assertFresh(action: string): void {
    this.#assertFresh(action);
  }

  #assertFresh(action: string): void {
    if (this.#replied || this.#deferred) throw new InteractionRepliedError('Cannot ' + action + ' an interaction that was already answered; use editReply() or followUp()');
  }

  #assertAnswered(action: string): void {
    if (!this.#replied && !this.#deferred) throw new InteractionRepliedError('Cannot ' + action + ' an interaction that was not answered yet; call reply() or deferReply() first');
  }
}

export class CommandOptions {
  constructor(private readonly client: Client, private readonly data: CommandData, private readonly guildId?: string) {}

  get all(): readonly CommandOptionValue[] {
    return leafOptions(this.data);
  }

  get focused(): CommandOptionValue | null {
    return this.all.find((option) => option.focused) ?? null;
  }

  get subcommand(): string | null {
    const first = this.data.options?.[0];
    if (!first) return null;
    if (first.type === 1) return first.name;
    return first.type === 2 ? first.options?.[0]?.name ?? null : null;
  }

  get subcommandGroup(): string | null {
    const first = this.data.options?.[0];
    return first?.type === 2 ? first.name : null;
  }

  has(name: string): boolean {
    return this.#find(name) !== undefined;
  }

  getString(name: string, required: true): string;
  getString(name: string, required?: boolean): string | null;
  getString(name: string, required = false): string | null {
    const value = this.#find(name)?.value;
    return this.#value(name, typeof value === 'string' ? value : null, required);
  }

  getInteger(name: string, required: true): number;
  getInteger(name: string, required?: boolean): number | null;
  getInteger(name: string, required = false): number | null {
    const value = this.#find(name)?.value;
    return this.#value(name, typeof value === 'number' && Number.isInteger(value) ? value : null, required);
  }

  getNumber(name: string, required: true): number;
  getNumber(name: string, required?: boolean): number | null;
  getNumber(name: string, required = false): number | null {
    const value = this.#find(name)?.value;
    return this.#value(name, typeof value === 'number' ? value : null, required);
  }

  getBoolean(name: string, required: true): boolean;
  getBoolean(name: string, required?: boolean): boolean | null;
  getBoolean(name: string, required = false): boolean | null {
    const value = this.#find(name)?.value;
    return this.#value(name, typeof value === 'boolean' ? value : null, required);
  }

  getUser(name: string, required: true): User;
  getUser(name: string, required?: boolean): User | null;
  getUser(name: string, required = false): User | null {
    const id = this.#id(name);
    const user = id === undefined ? undefined : this.data.resolved?.users?.[id];
    return this.#value(name, user ? new User(this.client, user) : null, required);
  }

  getMember(name: string, required: true): Member;
  getMember(name: string, required?: boolean): Member | null;
  getMember(name: string, required = false): Member | null {
    const id = this.#id(name);
    const member = id === undefined ? undefined : this.data.resolved?.members?.[id];
    const user = id === undefined ? undefined : this.data.resolved?.users?.[id];
    return this.#value(name, member && this.guildId ? new Member(this.client, { ...member, ...(user && { user }) }, this.guildId) : null, required);
  }

  getRole(name: string, required: true): MicupRole;
  getRole(name: string, required?: boolean): MicupRole | null;
  getRole(name: string, required = false): MicupRole | null {
    const id = this.#id(name);
    return this.#value(name, (id === undefined ? undefined : this.data.resolved?.roles?.[id]) ?? null, required);
  }

  getChannel(name: string, required: true): Channel;
  getChannel(name: string, required?: boolean): Channel | null;
  getChannel(name: string, required = false): Channel | null {
    const id = this.#id(name);
    const channel: MicupChannel | undefined = id === undefined ? undefined : this.data.resolved?.channels?.[id];
    return this.#value(name, channel ? new Channel(this.client, channel) : null, required);
  }

  getAttachment(name: string, required: true): { id: string; filename: string; url: string };
  getAttachment(name: string, required?: boolean): { id: string; filename: string; url: string } | null;
  getAttachment(name: string, required = false): { id: string; filename: string; url: string } | null {
    const id = this.#id(name);
    return this.#value(name, (id === undefined ? undefined : this.data.resolved?.attachments?.[id]) ?? null, required);
  }

  #find(name: string): CommandOptionValue | undefined {
    return this.all.find((option) => option.name === name);
  }

  #id(name: string): string | undefined {
    const value = this.#find(name)?.value;
    return typeof value === 'string' ? value : undefined;
  }

  #value<T>(name: string, value: T | null, required: boolean): T | null {
    if (value === null && required) throw new TypeError('The command option "' + name + '" is required but missing');
    return value;
  }
}

export class CommandInteraction extends Interaction {
  declare readonly raw: MicupInteraction & { type: 2; data: CommandData };
  readonly options: CommandOptions;

  constructor(client: Client, raw: MicupInteraction & { type: 2; data: CommandData }) {
    super(client, raw);
    this.options = new CommandOptions(client, raw.data, raw.guild_id);
  }

  get commandName(): string {
    return this.raw.data.name;
  }

  get commandId(): string {
    return this.raw.data.id;
  }

  get commandType(): number {
    return this.raw.data.type ?? CommandType.ChatInput;
  }

  get subcommand(): string | null {
    return this.options.subcommand;
  }

  get subcommandGroup(): string | null {
    return this.options.subcommandGroup;
  }

  get path(): string {
    return [this.commandName, this.subcommandGroup, this.subcommand].filter((part): part is string => Boolean(part)).join(' ');
  }

  get targetUser(): User | null {
    const id = this.raw.data.target_id;
    const user = id === undefined ? undefined : this.raw.data.resolved?.users?.[id];
    return user ? new User(this.client, user) : null;
  }

  get targetMessage(): Message | null {
    const id = this.raw.data.target_id;
    const message: MicupMessage | undefined = id === undefined ? undefined : this.raw.data.resolved?.messages?.[id];
    return message ? new Message(this.client, message) : null;
  }

  override isCommand(): this is CommandInteraction {
    return true;
  }

  isChatInput(): boolean {
    return this.commandType === CommandType.ChatInput;
  }

  isUserContextMenu(): boolean {
    return this.commandType === CommandType.User;
  }

  isMessageContextMenu(): boolean {
    return this.commandType === CommandType.Message;
  }

  async showModal(modal: MicupModal, options?: MicupRequestOptions): Promise<void> {
    this.assertFresh('show a modal on');
    await this.client.rest.interactions.modal(this.raw, modal, options);
    this.markReplied();
  }
}

export class AutocompleteInteraction extends Interaction {
  declare readonly raw: MicupInteraction & { type: 4; data: CommandData };
  readonly options: CommandOptions;

  constructor(client: Client, raw: MicupInteraction & { type: 4; data: CommandData }) {
    super(client, raw);
    this.options = new CommandOptions(client, raw.data, raw.guild_id);
  }

  get commandName(): string {
    return this.raw.data.name;
  }

  get subcommand(): string | null {
    return this.options.subcommand;
  }

  get subcommandGroup(): string | null {
    return this.options.subcommandGroup;
  }

  get path(): string {
    return [this.commandName, this.subcommandGroup, this.subcommand].filter((part): part is string => Boolean(part)).join(' ');
  }

  get focused(): CommandOptionValue | null {
    return this.options.focused;
  }

  override isAutocomplete(): this is AutocompleteInteraction {
    return true;
  }

  async respond(choices: readonly (CommandChoice | string | number)[], options?: MicupRequestOptions): Promise<void> {
    this.assertFresh('answer');
    const list = choices.slice(0, 25).map((choice): CommandChoice => typeof choice === 'object' ? choice : { name: String(choice), value: choice });
    await this.client.rest.interactions.autocomplete(this.raw, list, options);
    this.markReplied();
  }

  override async reply(): Promise<void> {
    throw new InteractionRepliedError('Use respond() to answer an autocomplete interaction');
  }

  override async deferReply(): Promise<void> {
    throw new InteractionRepliedError('Autocomplete interactions cannot be deferred');
  }
}

export class ComponentInteraction extends Interaction {
  declare readonly raw: MicupInteraction & { type: 3; data: ComponentData };

  constructor(client: Client, raw: MicupInteraction & { type: 3; data: ComponentData }) {
    super(client, raw);
  }

  get customId(): string {
    return this.raw.data.custom_id;
  }

  get componentType(): number {
    return this.raw.data.component_type;
  }

  get values(): readonly string[] {
    return this.raw.data.values ?? [];
  }

  get message(): Message | null {
    return this.raw.message ? new Message(this.client, this.raw.message) : null;
  }

  get users(): User[] {
    return this.values.flatMap((id) => this.raw.data.resolved?.users?.[id] ?? []).map((user) => new User(this.client, user));
  }

  get members(): Member[] {
    const guildId = this.guildId;
    if (!guildId) return [];
    return this.values.flatMap((id) => {
      const member = this.raw.data.resolved?.members?.[id];
      const user = this.raw.data.resolved?.users?.[id];
      return member ? [new Member(this.client, { ...member, ...(user && { user }) }, guildId)] : [];
    });
  }

  get roles(): MicupRole[] {
    return this.values.flatMap((id) => this.raw.data.resolved?.roles?.[id] ?? []);
  }

  get channels(): Channel[] {
    return this.values.flatMap((id) => this.raw.data.resolved?.channels?.[id] ?? []).map((channel) => new Channel(this.client, channel));
  }

  override isComponent(): this is ComponentInteraction {
    return true;
  }

  override isButton(): this is ComponentInteraction {
    return this.componentType === ComponentType.Button;
  }

  override isSelectMenu(): this is ComponentInteraction {
    return isSelectType(this.componentType);
  }

  async update(content: InteractionContent, options?: MicupRequestOptions): Promise<void> {
    this.assertFresh('update');
    const { message } = split(content);
    const input = typeof message === 'string' ? { content: message } : message;
    await this.client.rest.interactions.update(this.raw, input, options);
    this.markReplied();
  }

  async deferUpdate(options?: MicupRequestOptions): Promise<void> {
    this.assertFresh('defer the update of');
    await this.client.rest.interactions.deferUpdate(this.raw, options);
    this.markDeferred();
  }

  async showModal(modal: MicupModal, options?: MicupRequestOptions): Promise<void> {
    this.assertFresh('show a modal on');
    await this.client.rest.interactions.modal(this.raw, modal, options);
    this.markReplied();
  }
}

export class ModalFields {
  constructor(private readonly data: ModalData) {}

  get all(): Record<string, string> {
    const values: Record<string, string> = {};
    for (const row of this.data.components) for (const input of row.components ?? []) values[input.custom_id] = input.value;
    return values;
  }

  getTextInputValue(customId: string, required: true): string;
  getTextInputValue(customId: string, required?: boolean): string | null;
  getTextInputValue(customId: string, required = false): string | null {
    const value = this.all[customId];
    if (value === undefined) {
      if (required) throw new TypeError('The modal field "' + customId + '" is missing');
      return null;
    }
    return value;
  }
}

export class ModalSubmitInteraction extends Interaction {
  declare readonly raw: MicupInteraction & { type: 5; data: ModalData };
  readonly fields: ModalFields;

  constructor(client: Client, raw: MicupInteraction & { type: 5; data: ModalData }) {
    super(client, raw);
    this.fields = new ModalFields(raw.data);
  }

  get customId(): string {
    return this.raw.data.custom_id;
  }

  override isModalSubmit(): this is ModalSubmitInteraction {
    return true;
  }
}

export function createInteraction(client: Client, raw: MicupInteraction): Interaction {
  switch (raw.type) {
    case InteractionType.Command:
      return new CommandInteraction(client, raw as MicupInteraction & { type: 2; data: CommandData });
    case InteractionType.Autocomplete:
      return new AutocompleteInteraction(client, raw as MicupInteraction & { type: 4; data: CommandData });
    case InteractionType.Component:
      return new ComponentInteraction(client, raw as MicupInteraction & { type: 3; data: ComponentData });
    case InteractionType.Modal:
      return new ModalSubmitInteraction(client, raw as MicupInteraction & { type: 5; data: ModalData });
    default:
      return new Interaction(client, raw);
  }
}
