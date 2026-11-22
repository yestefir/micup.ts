import { InteractionType, type CommandChoice, type MicupInteraction } from '../model/interaction.js';
import type { MicupMessage } from '../model/entities.js';
import { messageBody, snowflake, type MessageInput } from './messages.js';
import type { MicupRequestOptions, RestTransport } from './transport.js';

export interface InteractionReplyOptions extends MicupRequestOptions {
  ephemeral?: boolean;
}

export interface MicupModal {
  title: string;
  custom_id: string;
  components: readonly Record<string, unknown>[];
}

const ephemeralFlag = 1 << 6;

function tokenPath(token: string): string {
  if (!token || token === '.' || token === '..') throw new TypeError('Interaction token is required');
  return encodeURIComponent(token);
}

function replyBody(message: string | MessageInput, ephemeral?: boolean): MessageInput {
  const input = typeof message === 'string' ? { content: message } : message;
  if (!input.content?.trim() && !input.embeds?.length && !input.components?.length && !input.files?.length) {
    throw new TypeError('Interaction reply requires content, embeds, components or files');
  }
  return ephemeral ? { ...input, flags: (input.flags ?? 0) | ephemeralFlag } : input;
}

type InteractionID = Pick<MicupInteraction, 'id' | 'token'>;
type InteractionApp = Pick<MicupInteraction, 'application_id' | 'token'>;

export class MicupInteractions {
  constructor(private readonly rest: RestTransport) {}

  #callback(interaction: InteractionID, type: number, data: unknown, signal?: AbortSignal): Promise<void> {
    const path = '/interactions/' + snowflake(interaction.id, 'Interaction ID') + '/' + tokenPath(interaction.token) + '/callback';
    return this.rest.request('POST', path, { body: { type, data }, signal });
  }

  #webhook(interaction: InteractionApp): string {
    return '/webhooks/' + snowflake(interaction.application_id, 'Application ID') + '/' + tokenPath(interaction.token);
  }

  respond(
    interaction: InteractionID, message: string | MessageInput, options: InteractionReplyOptions = {},
  ): Promise<void> {
    const input = replyBody(message, options.ephemeral);
    if (input.files?.length) throw new TypeError('Attach files in a follow-up after acknowledging the interaction');
    return this.#callback(interaction, 4, messageBody(input), options.signal);
  }

  defer(interaction: InteractionID, options: InteractionReplyOptions = {}): Promise<void> {
    return this.#callback(interaction, 5, options.ephemeral ? { flags: ephemeralFlag } : undefined, options.signal);
  }

  deferUpdate(interaction: MicupInteraction, { signal }: MicupRequestOptions = {}): Promise<void> {
    if (interaction.type !== InteractionType.Component) throw new TypeError('Only component interactions can defer an update');
    return this.#callback(interaction, 6, undefined, signal);
  }

  update(interaction: MicupInteraction, message: MessageInput, { signal }: MicupRequestOptions = {}): Promise<void> {
    if (interaction.type !== InteractionType.Component) throw new TypeError('Only component interactions can update a message');
    if (message.files?.length || message.attachments?.length) throw new TypeError('Component updates do not carry files');
    return this.#callback(interaction, 7, messageBody(message), signal);
  }

  autocomplete(
    interaction: MicupInteraction, choices: readonly CommandChoice[], { signal }: MicupRequestOptions = {},
  ): Promise<void> {
    if (interaction.type !== InteractionType.Autocomplete || choices.length > 25) {
      throw new TypeError('An autocomplete interaction takes up to 25 choices');
    }
    return this.#callback(interaction, 8, { choices }, signal);
  }

  modal(interaction: MicupInteraction, modal: MicupModal, { signal }: MicupRequestOptions = {}): Promise<void> {
    if ((interaction.type !== InteractionType.Command && interaction.type !== InteractionType.Component) ||
        !modal.custom_id || modal.custom_id.length > 100 || !modal.title || modal.title.length > 45 ||
        modal.components.length < 1 || modal.components.length > 5) {
      throw new TypeError('Invalid Micup modal or interaction');
    }
    return this.#callback(interaction, 9, modal, signal);
  }

  getResponse(interaction: InteractionApp, options?: MicupRequestOptions): Promise<MicupMessage> {
    return this.rest.request('GET', this.#webhook(interaction) + '/messages/@original', options);
  }

  editResponse(interaction: InteractionApp, message: MessageInput, options?: MicupRequestOptions): Promise<MicupMessage> {
    return this.rest.request('PATCH', this.#webhook(interaction) + '/messages/@original', {
      ...options, body: messageBody(message),
    });
  }

  deleteResponse(interaction: InteractionApp, options?: MicupRequestOptions): Promise<void> {
    return this.rest.request('DELETE', this.#webhook(interaction) + '/messages/@original', options);
  }

  followUp(
    interaction: InteractionApp, message: string | MessageInput, options: InteractionReplyOptions = {},
  ): Promise<MicupMessage> {
    return this.rest.request('POST', this.#webhook(interaction), {
      signal: options.signal, body: messageBody(replyBody(message, options.ephemeral)),
    });
  }
}
