import type { MessageInput } from '../rest/messages.js';
import { ButtonStyle } from '../model/components.js';
import { actionRow } from '../model/components.js';
import { ComponentInteraction, type Interaction } from './interactions.js';
import { Message } from './structures.js';

export type PageContent = string | MessageInput;

export type PageSource = readonly PageContent[] | { count: number; page: (index: number) => PageContent | Promise<PageContent> };

export interface PaginateOptions {
  timeoutMs?: number;
  onlyInvoker?: boolean;
  ephemeral?: boolean;
  startPage?: number;
  jumpButtons?: boolean;
  labels?: { first?: string; previous?: string; next?: string; last?: string; stop?: string };
  deniedReply?: string | false;
  signal?: AbortSignal;
}

export interface PaginateResult {
  reason: 'finished' | 'stopped' | 'timeout' | 'aborted';
  page: number;
}

const defaultLabels = { first: '«', previous: '‹', next: '›', last: '»', stop: '✕' };

function normalize(page: PageContent): MessageInput {
  if (typeof page === 'string') return { content: page, embeds: [] };
  return { ...page, content: page.content ?? null, embeds: page.embeds ?? [] };
}

function randomId(): string {
  return Math.random().toString(36).slice(2, 10);
}

export async function paginate(target: Interaction | Message, source: PageSource, options: PaginateOptions = {}): Promise<PaginateResult> {
  if (!target || typeof target !== 'object' || !('client' in target)) throw new TypeError('Pagination target must be a message or interaction');
  if (!Array.isArray(source) && (!source || typeof source !== 'object' ||
      typeof (source as { page?: unknown }).page !== 'function')) {
    throw new TypeError('A paginated source must be an array or provide a page function');
  }
  const total = Array.isArray(source) ? source.length : (source as { count: number }).count;
  if (!Number.isSafeInteger(total) || total < 1) throw new RangeError('Pagination needs at least one page');
  const { timeoutMs = 120_000, onlyInvoker = true, ephemeral, jumpButtons = false, deniedReply, signal } = options;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2_147_483_647) {
    throw new RangeError('Pagination timeout must be a positive timer duration');
  }
  if (typeof onlyInvoker !== 'boolean' || typeof jumpButtons !== 'boolean' ||
      (ephemeral !== undefined && typeof ephemeral !== 'boolean')) {
    throw new TypeError('Pagination access, jump, and ephemeral options must be booleans');
  }
  if (deniedReply !== undefined && deniedReply !== false && typeof deniedReply !== 'string') {
    throw new TypeError('Pagination denied reply must be a string or false');
  }
  if (options.labels !== undefined) {
    if (!options.labels || typeof options.labels !== 'object' || Array.isArray(options.labels) ||
        Object.keys(options.labels).some((key) => !['first', 'previous', 'next', 'last', 'stop'].includes(key)) ||
        Object.values(options.labels).some((label) => typeof label !== 'string' || !label || [...label].length > 80)) {
      throw new TypeError('Pagination labels must be nonempty strings of up to 80 characters');
    }
  }
  const labels = { ...defaultLabels, ...options.labels };
  let index = options.startPage ?? 0;
  if (!Number.isSafeInteger(index) || index < 0 || index >= total) throw new RangeError('The start page is outside the pages');

  const load = async (position: number): Promise<MessageInput> => normalize(Array.isArray(source)
    ? source[position]
    : await (source as { page: (index: number) => PageContent | Promise<PageContent> }).page(position));
  const client = target.client;
  const invokerId = target instanceof Message ? target.author.id : target.user.id;
  const prefix = 'pg-' + randomId() + ':';

  const row = (position: number, disabled = false) => {
    const button = (action: string, label: string, off: boolean, style: number = ButtonStyle.Secondary) =>
      ({ type: 2 as const, style: style as 2, custom_id: prefix + action, label, disabled: disabled || off });
    const indicator = { type: 2 as const, style: ButtonStyle.Secondary as 2, custom_id: prefix + 'page', label: (position + 1) + '/' + total, disabled: true };
    const atStart = position === 0;
    const atEnd = position === total - 1;
    return jumpButtons
      ? actionRow(button('first', labels.first, atStart), button('previous', labels.previous, atStart), indicator, button('next', labels.next, atEnd), button('last', labels.last, atEnd))
      : actionRow(button('previous', labels.previous, atStart), indicator, button('next', labels.next, atEnd), button('stop', labels.stop, false, ButtonStyle.Danger));
  };
  const view = async (position: number, disabled = false): Promise<MessageInput> => ({ ...(await load(position)), components: total > 1 ? [row(position, disabled)] : [] });

  if (signal?.aborted) return { reason: 'aborted', page: index };
  const first = await view(index);
  if (signal?.aborted) return { reason: 'aborted', page: index };
  let message: Message | undefined;
  if (target instanceof Message) {
    message = await target.reply(first);
  } else if (target.replied || target.deferred) {
    message = await target.editReply(first);
  } else {
    await target.reply({ ...first, ...(ephemeral !== undefined && { ephemeral }) });
  }
  if (total === 1) return { reason: 'finished', page: index };

  const close = async (): Promise<void> => {
    try {
      const disabled = await view(index, true);
      if (message) await message.edit(disabled);
      else if (!(target instanceof Message)) await (target as Interaction).editReply(disabled);
    } catch {}
  };

  while (true) {
    let click: ComponentInteraction;
    try {
      click = await client.awaitInteraction<ComponentInteraction>({
        filter: (candidate) => candidate instanceof ComponentInteraction && candidate.customId.startsWith(prefix),
        timeoutMs,
        signal,
      });
    } catch (error) {
      if (signal?.aborted) {
        await close();
        return { reason: 'aborted', page: index };
      }
      if (error instanceof Error && error.message.startsWith('Timed out')) {
        await close();
        return { reason: 'timeout', page: index };
      }
      throw error;
    }
    if (onlyInvoker && click.user.id !== invokerId) {
      if (deniedReply !== false) {
        try {
          await click.reply({ content: deniedReply ?? 'Only <@' + invokerId + '> can use these buttons.', ephemeral: true });
        } catch {}
      }
      continue;
    }
    const action = click.customId.slice(prefix.length);
    if (action === 'stop') {
      await click.update({ components: [] });
      return { reason: 'stopped', page: index };
    }
    const next = action === 'first' ? 0 : action === 'last' ? total - 1 : action === 'next' ? Math.min(total - 1, index + 1) : Math.max(0, index - 1);
    let nextView: MessageInput;
    try {
      nextView = await view(next);
    } catch (error) {
      try {
        await click.reply({ content: 'Could not load that page. Please try again.', ephemeral: true });
      } catch {}
      throw error;
    }
    await click.update(nextView);
    index = next;
  }
}
