import type { GatewayDispatch } from '../gateway/protocol.js';
import { MicupClient } from '../bot/client.js';
import type { MicupEvents } from '../events/mux.js';
import type { MessageCatalog } from '../model/locale.js';
import { localizeCommand } from '../model/localize.js';
import type { MicupGuild, MicupVoiceState } from '../model/guild.js';
import type { MicupMessage, MicupUser } from '../model/entities.js';
import type { CommandDefinition, MicupCommand, MicupInteraction } from '../model/interaction.js';
import type { Presence, PresenceStatus, CustomStatus } from '../model/presence.js';
import type { MicupLogger, MicupRequestOptions } from '../rest/transport.js';
import { GatewaySession, type GatewaySessionOptions } from '../session/session.js';
import type { ShardManager } from '../shard/manager.js';
import { Emitter } from './emitter.js';
import {
  AutocompleteInteraction, CommandInteraction, ComponentInteraction, Interaction, ModalSubmitInteraction, createInteraction,
} from './interactions.js';
import { Channel, Guild, Member, Message, ReactionEvent, User } from './structures.js';

export interface ErrorContext {
  event?: string;
  interaction?: Interaction;
}

export interface MessageDeleteEvent {
  id: string;
  channelId: string;
  guildId?: string;
  content?: string | null;
  authorId?: string;
}

export interface MemberRemoveEvent {
  guildId: string;
  user: User;
}

export interface GuildDeleteEvent {
  id: string;
  unavailable: boolean;
}

export class MessageUpdate {
  constructor(readonly client: Client, readonly raw: Partial<MicupMessage> & { id: string; channel_id: string }) {}

  get id(): string {
    return this.raw.id;
  }

  get channelId(): string {
    return this.raw.channel_id;
  }

  get guildId(): string | undefined {
    return this.raw.guild_id;
  }

  get content(): string | undefined {
    return this.raw.content;
  }

  get editedAt(): Date | null {
    return this.raw.edited_timestamp ? new Date(this.raw.edited_timestamp) : null;
  }

  get message(): Message | null {
    return this.raw.author && this.raw.content !== undefined ? new Message(this.client, this.raw as MicupMessage) : null;
  }

  async fetch(options?: MicupRequestOptions): Promise<Message> {
    return new Message(this.client, await this.client.rest.getMessage(this.channelId, this.id, options));
  }
}

export interface ClientEvents {
  ready: [client: Client];
  shardReady: [shardId: number];
  shardResume: [shardId: number];
  shardDisconnect: [error: unknown];
  error: [error: Error, context: ErrorContext];
  raw: [event: GatewayDispatch];
  messageCreate: [message: Message];
  messageUpdate: [update: MessageUpdate];
  messageDelete: [event: MessageDeleteEvent];
  interactionCreate: [interaction: Interaction];
  guildCreate: [guild: Guild];
  guildUpdate: [guild: Guild];
  guildDelete: [event: GuildDeleteEvent];
  guildMemberAdd: [member: Member];
  guildMemberUpdate: [member: Member];
  guildMemberRemove: [event: MemberRemoveEvent];
  guildBanAdd: [event: MemberRemoveEvent];
  guildBanRemove: [event: MemberRemoveEvent];
  channelCreate: [channel: Channel];
  channelUpdate: [channel: Channel];
  channelDelete: [channel: Channel];
  messageReactionAdd: [reaction: ReactionEvent];
  messageReactionRemove: [reaction: ReactionEvent];
  voiceStateUpdate: [state: MicupVoiceState];
}

export interface RegisterCommandsOptions {
  guildId?: string;
  prune?: boolean;
}

export interface RegisterCommandsResult {
  created: string[];
  updated: string[];
  unchanged: string[];
  deleted: string[];
}

export interface ClientOptions {
  token?: string;
  origin?: string;
  rest?: MicupClient;
  gateway?: boolean;
  shards?: number | 'auto';
  compress?: boolean;
  trackMembers?: boolean;
  presence?: Presence;
  ignoredEvents?: readonly string[];
  flags?: number;
  minBackoffMs?: number;
  maxBackoffMs?: number;
  maxRestAttempts?: number;
  logger?: MicupLogger;
  sequential?: boolean;
  readyTimeoutMs?: number;
  errorReply?: string | false | ((error: unknown, interaction: Interaction) => string | undefined);
  registerCommands?: boolean | RegisterCommandsOptions;
  catalog?: MessageCatalog;
  localizeCommands?: boolean;
  strictLocalization?: boolean;
}

export interface AwaitInteractionOptions<T extends Interaction = Interaction> {
  filter?: (interaction: T) => boolean;
  timeoutMs?: number;
  signal?: AbortSignal;
}

type CommandSource = CommandDefinition | { toJSON(): CommandDefinition };
type Matcher = string | RegExp;
type Handler<I> = (interaction: I) => unknown;
interface Route<I> {
  match: Matcher;
  handler: Handler<I>;
}

interface Waiter {
  filter: (interaction: Interaction) => boolean;
  resolve: (interaction: Interaction) => void;
}

const defaultErrorReply = 'Something went wrong while running this command.';

function matches(matcher: Matcher, value: string): boolean {
  if (matcher instanceof RegExp) return matcher.test(value);
  return matcher.endsWith('*') ? value.startsWith(matcher.slice(0, -1)) : matcher === value;
}

function strip(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(strip);
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([key]) => key !== 'name_localized' && key !== 'description_localized')
      .map(([key, item]) => [key, strip(item)] as const)
      .filter(([, item]) => item !== undefined && item !== null && item !== false && item !== '' && !(Array.isArray(item) && !item.length));
    return Object.fromEntries(entries.sort(([a], [b]) => a < b ? -1 : 1));
  }
  return value;
}

function sameCommand(existing: MicupCommand, wanted: CommandDefinition): boolean {
  const pick = (command: CommandDefinition) => strip({
    description: command.description ?? '',
    name_localizations: command.name_localizations,
    description_localizations: command.description_localizations,
    options: command.options,
    default_member_permissions: command.default_member_permissions,
    dm_permission: command.dm_permission === true ? undefined : command.dm_permission,
  });
  return JSON.stringify(pick(existing)) === JSON.stringify(pick(wanted));
}

class UserManager {
  constructor(private readonly client: Client) {}

  async fetch(userId: string, options?: MicupRequestOptions): Promise<User> {
    return new User(this.client, await this.client.rest.users.get(userId, options));
  }
}

class GuildManager {
  constructor(private readonly client: Client) {}

  get size(): number {
    return this.client.guildCount;
  }

  get(guildId: string): Guild | undefined {
    const raw = this.client.sessionFor(guildId)?.state.guild(guildId);
    return raw ? new Guild(this.client, raw) : undefined;
  }

  async fetch(guildId: string, options?: MicupRequestOptions): Promise<Guild> {
    return new Guild(this.client, await this.client.rest.guilds.get(guildId, options));
  }

  async *list(options?: MicupRequestOptions): AsyncGenerator<Guild> {
    for await (const guild of this.client.rest.users.iterateGuilds(options)) yield new Guild(this.client, guild);
  }
}

class ChannelManager {
  constructor(private readonly client: Client) {}

  get(channelId: string): Channel | undefined {
    for (const session of this.client.sessions) {
      const raw = session.state.channel(channelId);
      if (raw) return new Channel(this.client, raw);
    }
    return undefined;
  }

  async fetch(channelId: string, options?: MicupRequestOptions): Promise<Channel> {
    return new Channel(this.client, await this.client.rest.channels.get(channelId, options));
  }
}

export class Client {
  readonly users: UserManager = new UserManager(this);
  readonly guilds: GuildManager = new GuildManager(this);
  readonly channels: ChannelManager = new ChannelManager(this);
  user: User | undefined;
  readyAt: Date | undefined;
  #rest?: MicupClient;
  #session?: GatewaySession;
  #manager?: ShardManager;
  #running?: Promise<void>;
  #stop?: AbortController;
  #loggingIn = false;
  #isReady = false;
  #readyShards = new Set<number>();
  #expectedShards = 1;
  #pendingGuilds = new Set<string>();
  #gate?: { check: () => void };
  readonly #emitter = new Emitter();
  readonly #definitions: CommandDefinition[] = [];
  readonly #commands = new Map<string, Handler<CommandInteraction>>();
  readonly #autocompletes = new Map<string, Handler<AutocompleteInteraction>>();
  readonly #components: Route<ComponentInteraction>[] = [];
  readonly #modals: Route<ModalSubmitInteraction>[] = [];
  readonly #waiters = new Set<Waiter>();

  constructor(readonly options: ClientOptions = {}) {
    this.#rest = options.rest;
  }

  get rest(): MicupClient {
    if (!this.#rest) throw new Error('Call login() before using the client');
    return this.#rest;
  }

  get ready(): boolean {
    return this.#isReady;
  }

  get sessions(): readonly GatewaySession[] {
    return this.#manager ? this.#manager.shards : this.#session ? [this.#session] : [];
  }

  get guildCount(): number {
    return this.#manager?.guildCount ?? this.#session?.state.guildCount ?? 0;
  }

  get latency(): number | undefined {
    return this.#manager?.latency ?? this.#session?.latency;
  }

  get uptime(): number | undefined {
    return this.readyAt ? Date.now() - this.readyAt.getTime() : undefined;
  }

  on<K extends keyof ClientEvents>(event: K, listener: (...args: ClientEvents[K]) => unknown): this;
  on<K extends keyof MicupEvents>(event: K, listener: (data: MicupEvents[K], event: GatewayDispatch) => unknown): this;
  on(event: string, listener: (data: unknown, event: GatewayDispatch) => unknown): this;
  on(event: string, listener: (...args: any[]) => unknown): this {
    this.#emitter.add(event, listener);
    return this;
  }

  once<K extends keyof ClientEvents>(event: K, listener: (...args: ClientEvents[K]) => unknown): this;
  once<K extends keyof MicupEvents>(event: K, listener: (data: MicupEvents[K], event: GatewayDispatch) => unknown): this;
  once(event: string, listener: (data: unknown, event: GatewayDispatch) => unknown): this;
  once(event: string, listener: (...args: any[]) => unknown): this {
    const wrapper = (...args: unknown[]) => {
      this.#emitter.remove(event, listener);
      return listener(...args);
    };
    this.#emitter.add(event, listener, wrapper);
    return this;
  }

  off<K extends keyof ClientEvents>(event: K, listener: (...args: ClientEvents[K]) => unknown): this;
  off<K extends keyof MicupEvents>(event: K, listener: (data: MicupEvents[K], event: GatewayDispatch) => unknown): this;
  off(event: string, listener: (data: unknown, event: GatewayDispatch) => unknown): this;
  off(event: string, listener: (...args: any[]) => unknown): this {
    this.#emitter.remove(event, listener);
    return this;
  }

  command(target: CommandSource, handler?: Handler<CommandInteraction>): this;
  command(path: string, handler: Handler<CommandInteraction>): this;
  command(target: CommandSource | string, handler?: Handler<CommandInteraction>): this {
    if (typeof target === 'string') {
      if (!handler) throw new TypeError('A command route needs a handler');
      this.#commands.set(target.trim().replace(/\s+/g, ' '), handler);
      return this;
    }
    const definition = 'toJSON' in target ? target.toJSON() : target;
    const index = this.#definitions.findIndex((existing) => existing.name === definition.name && (existing.type ?? 1) === (definition.type ?? 1));
    if (index >= 0) this.#definitions[index] = definition;
    else this.#definitions.push(definition);
    if (handler) this.#commands.set(definition.name, handler);
    return this;
  }

  autocomplete(path: string, handler: Handler<AutocompleteInteraction>): this {
    this.#autocompletes.set(path.trim().replace(/\s+/g, ' '), handler);
    return this;
  }

  component(match: Matcher, handler: Handler<ComponentInteraction>): this {
    this.#components.push({ match, handler });
    return this;
  }

  modal(match: Matcher, handler: Handler<ModalSubmitInteraction>): this {
    this.#modals.push({ match, handler });
    return this;
  }

  get commandDefinitions(): readonly CommandDefinition[] {
    return this.#localized();
  }

  get catalog(): MessageCatalog | undefined {
    return this.options.catalog;
  }

  text(locale: string | undefined, key: string, ...values: unknown[]): string {
    if (!this.options.catalog) throw new Error('Pass a catalog to the client options to translate messages');
    return this.options.catalog.textIn(locale, key, ...values);
  }

  #localized(): CommandDefinition[] {
    const catalog = this.options.catalog;
    if (!catalog || this.options.localizeCommands === false) return [...this.#definitions];
    return this.#definitions.map((definition) => localizeCommand(definition, catalog, { strict: this.options.strictLocalization }));
  }

  async login(token?: string): Promise<this> {
    if (this.#loggingIn || this.#running || this.#isReady) throw new Error('The client is already logged in');
    this.#loggingIn = true;
    try {
      if (!this.#rest) {
        const resolved = token ?? this.options.token ?? process.env.MICUP_BOT_TOKEN;
        if (!resolved) throw new TypeError('A bot token is required: pass it to login(), the client options or MICUP_BOT_TOKEN');
        this.#rest = await MicupClient.connect({ token: resolved, origin: this.options.origin, maxRestAttempts: this.options.maxRestAttempts, logger: this.options.logger });
      }
      this.user = new User(this, this.#rest.self);
      this.#stop = new AbortController();
      if (this.options.gateway === false) {
        await this.#finishReady();
        return this;
      }
      await this.#startGateway(this.#stop.signal);
      return this;
    } catch (error) {
      this.#stop?.abort();
      this.#running = undefined;
      throw error;
    } finally {
      this.#loggingIn = false;
    }
  }

  async destroy(): Promise<void> {
    this.#stop?.abort();
    const running = this.#running;
    this.#running = undefined;
    this.#session = undefined;
    this.#manager = undefined;
    this.#isReady = false;
    this.#readyShards.clear();
    this.#pendingGuilds.clear();
    for (const waiter of this.#waiters) waiter.resolve = () => {};
    this.#waiters.clear();
    await running?.catch(() => {});
  }

  sessionFor(guildId: string): GatewaySession | undefined {
    if (this.#manager) {
      try {
        return this.#manager.forGuild(guildId);
      } catch {
        return undefined;
      }
    }
    return this.#session;
  }

  permissionsFor(guildId: string, userId: string, channelId?: string): bigint | undefined {
    return this.sessionFor(guildId)?.state.permissions(guildId, userId, channelId);
  }

  setPresence(presence: Presence, options?: { signal?: AbortSignal }): Promise<void> {
    return this.#presenceTarget().updatePresence(presence, options);
  }

  setStatus(status: PresenceStatus, options?: { signal?: AbortSignal }): Promise<void> {
    return this.#presenceTarget().setStatus(status, options);
  }

  setCustomStatus(status: CustomStatus | string | null, options?: { signal?: AbortSignal }): Promise<void> {
    return this.#presenceTarget().setCustomStatus(typeof status === 'string' ? { text: status } : status, options);
  }

  async registerCommands(options: RegisterCommandsOptions = {}): Promise<RegisterCommandsResult> {
    const scope = { guildId: options.guildId };
    const result: RegisterCommandsResult = { created: [], updated: [], unchanged: [], deleted: [] };
    const existing = await this.rest.commands.list(scope);
    const key = (command: { name: string; type?: number }) => (command.type ?? 1) + ':' + command.name;
    const known = new Map(existing.map((command) => [key(command), command]));
    const wanted = this.#localized();
    for (const definition of wanted) {
      const found = known.get(key(definition));
      if (!found) {
        await this.rest.commands.create(definition, scope);
        result.created.push(definition.name);
      } else if (!sameCommand(found, definition)) {
        await this.rest.commands.edit(found.id, definition, scope);
        result.updated.push(definition.name);
      } else {
        result.unchanged.push(definition.name);
      }
    }
    if (options.prune) {
      const kept = new Set(wanted.map(key));
      for (const command of existing) {
        if (kept.has(key(command))) continue;
        await this.rest.commands.delete(command.id, scope);
        result.deleted.push(command.name);
      }
    }
    return result;
  }

  awaitInteraction<T extends Interaction = Interaction>(options: AwaitInteractionOptions<T> = {}): Promise<T> {
    const { filter = () => true, timeoutMs, signal } = options;
    signal?.throwIfAborted();
    return new Promise<T>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const finish = () => {
        this.#waiters.delete(waiter);
        if (timer) clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
      };
      const abort = () => {
        finish();
        reject(signal?.reason);
      };
      const waiter: Waiter = {
        filter: (interaction) => filter(interaction as T),
        resolve: (interaction) => {
          finish();
          resolve(interaction as T);
        },
      };
      this.#waiters.add(waiter);
      signal?.addEventListener('abort', abort, { once: true });
      if (timeoutMs !== undefined) {
        timer = setTimeout(() => {
          finish();
          reject(new Error('Timed out waiting for an interaction'));
        }, timeoutMs);
      }
      if (signal?.aborted) abort();
    });
  }

  async handleDispatch(event: GatewayDispatch, signal: AbortSignal = new AbortController().signal): Promise<void> {
    const pending = this.#route(event, signal);
    if (this.options.sequential) await pending;
    else void pending;
  }

  #presenceTarget(): { updatePresence(presence: Presence, options?: { signal?: AbortSignal }): Promise<void>; setStatus(status: PresenceStatus, options?: { signal?: AbortSignal }): Promise<void>; setCustomStatus(status: CustomStatus | null, options?: { signal?: AbortSignal }): Promise<void> } {
    const target = this.#manager ?? this.#session;
    if (!target) throw new Error('Presence needs a running Gateway session');
    return target;
  }

  async #startGateway(signal: AbortSignal): Promise<void> {
    const sessionOptions: GatewaySessionOptions = {
      handler: (event, lifetime) => this.handleDispatch(event, lifetime),
      compress: this.options.compress,
      trackMembers: this.options.trackMembers,
      presence: this.options.presence,
      ignoredEvents: this.options.ignoredEvents,
      flags: this.options.flags,
      minBackoffMs: this.options.minBackoffMs,
      maxBackoffMs: this.options.maxBackoffMs,
      logger: this.options.logger,
      onDisconnect: (error) => { void this.#emit('shardDisconnect', [error]); },
    };
    const requested = this.options.shards;
    const count = requested === 'auto' ? await this.rest.recommendedShards({ signal }) : requested ?? 1;
    if (!Number.isSafeInteger(count) || count < 1) throw new RangeError('The shard count must be a positive integer');
    this.#expectedShards = count;
    if (count === 1) {
      this.#session = this.rest.newSession(sessionOptions);
      this.#running = this.#session.run({ signal });
    } else {
      this.#manager = this.rest.newShardManager({ shardCount: count, session: sessionOptions });
      this.#running = this.#manager.run({ signal });
    }

    const ready = new Promise<void>((resolve, reject) => {
      const timeoutMs = this.options.readyTimeoutMs ?? 15_000;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const done = () => {
        if (timer) clearTimeout(timer);
        this.#gate = undefined;
        resolve();
      };
      this.#gate = {
        check: () => {
          if (this.#readyShards.size < this.#expectedShards) return;
          if (!this.#pendingGuilds.size) return done();
          timer ??= setTimeout(done, timeoutMs);
        },
      };
      void this.#running?.then(
        () => reject(new Error('The Gateway session ended before the client was ready')),
        (error) => reject(error),
      );
    });
    await ready;
    await this.#finishReady();
  }

  async #finishReady(): Promise<void> {
    if (this.#isReady) return;
    this.#isReady = true;
    this.readyAt = new Date();
    if (this.#definitions.length && this.options.registerCommands !== false) {
      const scope = typeof this.options.registerCommands === 'object' ? this.options.registerCommands : {};
      try {
        await this.registerCommands(scope);
      } catch (error) {
        this.#report(error, { event: 'registerCommands' });
      }
    }
    await this.#emit('ready', [this]);
  }

  async #route(event: GatewayDispatch, signal: AbortSignal): Promise<void> {
    const name = event.name;
    const data = event.data as any;
    try {
      this.#track(event, data);
    } catch (error) {
      this.#report(error, { event: name });
    }
    const tasks: unknown[] = [];
    const push = (eventName: string, args: unknown[]) => tasks.push(this.#emit(eventName, args, { event: name }));
    try {
      if (this.#emitter.count('raw')) push('raw', [event]);
      if (this.#emitter.count(name)) push(name, [data, event]);
      switch (name) {
        case 'MESSAGE_CREATE':
          if (this.#emitter.count('messageCreate')) push('messageCreate', [new Message(this, data)]);
          break;
        case 'MESSAGE_UPDATE':
          if (this.#emitter.count('messageUpdate')) push('messageUpdate', [new MessageUpdate(this, data)]);
          break;
        case 'MESSAGE_DELETE':
          if (this.#emitter.count('messageDelete')) {
            push('messageDelete', [{ id: data.id, channelId: data.channel_id, guildId: data.guild_id, content: data.content, authorId: data.author_id } satisfies MessageDeleteEvent]);
          }
          break;
        case 'GUILD_CREATE':
          if (this.#emitter.count('guildCreate')) push('guildCreate', [new Guild(this, data)]);
          break;
        case 'GUILD_UPDATE':
          if (this.#emitter.count('guildUpdate')) push('guildUpdate', [new Guild(this, data)]);
          break;
        case 'GUILD_DELETE':
          if (this.#emitter.count('guildDelete')) push('guildDelete', [{ id: data.id, unavailable: data.unavailable === true } satisfies GuildDeleteEvent]);
          break;
        case 'GUILD_MEMBER_ADD':
          if (this.#emitter.count('guildMemberAdd')) push('guildMemberAdd', [new Member(this, data, data.guild_id)]);
          break;
        case 'GUILD_MEMBER_UPDATE':
          if (this.#emitter.count('guildMemberUpdate')) push('guildMemberUpdate', [new Member(this, data, data.guild_id)]);
          break;
        case 'GUILD_MEMBER_REMOVE':
          if (this.#emitter.count('guildMemberRemove') && data.user) push('guildMemberRemove', [{ guildId: data.guild_id, user: new User(this, data.user) } satisfies MemberRemoveEvent]);
          break;
        case 'GUILD_BAN_ADD':
          if (this.#emitter.count('guildBanAdd')) push('guildBanAdd', [{ guildId: data.guild_id, user: new User(this, data.user) } satisfies MemberRemoveEvent]);
          break;
        case 'GUILD_BAN_REMOVE':
          if (this.#emitter.count('guildBanRemove')) push('guildBanRemove', [{ guildId: data.guild_id, user: new User(this, data.user) } satisfies MemberRemoveEvent]);
          break;
        case 'CHANNEL_CREATE':
          if (this.#emitter.count('channelCreate')) push('channelCreate', [new Channel(this, data)]);
          break;
        case 'CHANNEL_UPDATE':
          if (this.#emitter.count('channelUpdate')) push('channelUpdate', [new Channel(this, data)]);
          break;
        case 'CHANNEL_DELETE':
          if (this.#emitter.count('channelDelete')) push('channelDelete', [new Channel(this, data)]);
          break;
        case 'MESSAGE_REACTION_ADD':
          if (this.#emitter.count('messageReactionAdd')) push('messageReactionAdd', [new ReactionEvent(this, data)]);
          break;
        case 'MESSAGE_REACTION_REMOVE':
          if (this.#emitter.count('messageReactionRemove')) push('messageReactionRemove', [new ReactionEvent(this, data)]);
          break;
        case 'VOICE_STATE_UPDATE':
          if (this.#emitter.count('voiceStateUpdate')) push('voiceStateUpdate', [data]);
          break;
        case 'INTERACTION_CREATE':
          tasks.push(this.#interaction(data as MicupInteraction));
          break;
        default:
          break;
      }
    } catch (error) {
      this.#report(error, { event: name });
    }
    if (signal.aborted) return;
    try {
      await Promise.all(tasks);
    } catch (error) {
      this.#report(error, { event: name });
    }
  }

  #track(event: GatewayDispatch, data: any): void {
    if (event.name === 'READY') {
      this.#readyShards.add(event.shardId);
      for (const guild of (data?.guilds ?? []) as MicupGuild[]) if (guild?.id && guild.unavailable !== false) this.#pendingGuilds.add(guild.id);
      if (data?.user) this.user = new User(this, data.user as MicupUser);
      void this.#emit('shardReady', [event.shardId]);
      this.#gate?.check();
    } else if (event.name === 'RESUMED') {
      void this.#emit('shardResume', [event.shardId]);
    } else if (event.name === 'GUILD_CREATE' || event.name === 'GUILD_DELETE') {
      const id = (data as { id?: string } | null)?.id;
      if (id) this.#pendingGuilds.delete(id);
      this.#gate?.check();
    }
  }

  async #interaction(raw: MicupInteraction): Promise<void> {
    let interaction: Interaction;
    try {
      interaction = createInteraction(this, raw);
    } catch (error) {
      this.#report(error, { event: 'INTERACTION_CREATE' });
      return;
    }
    for (const waiter of [...this.#waiters]) {
      if (waiter.filter(interaction)) {
        waiter.resolve(interaction);
        break;
      }
    }
    const tasks: Promise<void>[] = [this.#emit('interactionCreate', [interaction], { event: 'INTERACTION_CREATE', interaction })];
    const route = this.#find(interaction);
    if (route) tasks.push(this.#run(route, interaction));
    await Promise.all(tasks);
  }

  #find(interaction: Interaction): (() => unknown) | undefined {
    if (interaction instanceof CommandInteraction) {
      const parts = interaction.path.split(' ');
      for (let length = parts.length; length >= 1; length--) {
        const handler = this.#commands.get(parts.slice(0, length).join(' '));
        if (handler) return () => handler(interaction);
      }
    } else if (interaction instanceof AutocompleteInteraction) {
      const parts = interaction.path.split(' ');
      for (let length = parts.length; length >= 1; length--) {
        const handler = this.#autocompletes.get(parts.slice(0, length).join(' '));
        if (handler) return () => handler(interaction);
      }
    } else if (interaction instanceof ComponentInteraction) {
      const route = this.#components.find((candidate) => matches(candidate.match, interaction.customId));
      if (route) return () => route.handler(interaction);
    } else if (interaction instanceof ModalSubmitInteraction) {
      const route = this.#modals.find((candidate) => matches(candidate.match, interaction.customId));
      if (route) return () => route.handler(interaction);
    }
    return undefined;
  }

  async #run(route: () => unknown, interaction: Interaction): Promise<void> {
    try {
      await route();
    } catch (error) {
      this.#report(error, { event: 'INTERACTION_CREATE', interaction });
      await this.#replyWithError(error, interaction);
    }
  }

  async #replyWithError(error: unknown, interaction: Interaction): Promise<void> {
    const setting = this.options.errorReply;
    if (setting === false || interaction.replied || interaction.deferred || interaction.isAutocomplete()) return;
    const translated = this.options.catalog?.has('error.generic') ? this.options.catalog.text(interaction.raw, 'error.generic') : undefined;
    const content = typeof setting === 'function' ? setting(error, interaction) : setting ?? translated ?? defaultErrorReply;
    if (!content) return;
    try {
      await interaction.reply({ content, ephemeral: true });
    } catch {}
  }

  async #emit(name: string, args: unknown[], context: ErrorContext = {}): Promise<void> {
    const listeners = this.#emitter.listeners(name);
    if (!listeners.length) return;
    const runs = listeners.map(async (listener) => {
      try {
        await listener(...args);
      } catch (error) {
        if (name === 'error') console.error('[micup.ts] an error listener failed', error);
        else this.#report(error, context);
      }
    });
    if (this.options.sequential || name === 'ready') await Promise.all(runs);
    else void Promise.all(runs);
  }

  #report(error: unknown, context: ErrorContext): void {
    const failure = error instanceof Error ? error : new Error(String(error));
    if (this.#emitter.count('error')) {
      for (const listener of this.#emitter.listeners('error')) {
        try {
          void Promise.resolve(listener(failure, context)).catch((cause) => console.error('[micup.ts] an error listener failed', cause));
        } catch (cause) {
          console.error('[micup.ts] an error listener failed', cause);
        }
      }
    } else {
      console.error('[micup.ts]', context.event ? '(' + context.event + ')' : '', failure);
    }
  }
}

