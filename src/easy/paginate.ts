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
  const total = Array.isArray(source) ? source.length : (source as { count: number }).count;
  if (!Number.isSafeInteger(total) || total < 1) throw new RangeError('Pagination needs at least one page');
  const { timeoutMs = 120_000, onlyInvoker = true, ephemeral, jumpButtons = false, deniedReply, signal } = options;
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

  const first = await view(index);
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
      if (signal?.aborted) return { reason: 'aborted', page: index };
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
      await click.update({ ...(await load(index)), components: [] });
      return { reason: 'stopped', page: index };
    }
    index = action === 'first' ? 0 : action === 'last' ? total - 1 : action === 'next' ? Math.min(total - 1, index + 1) : Math.max(0, index - 1);
    await click.update(await view(index));
  }
}
