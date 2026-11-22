import type { Emoji } from './format.js';

export const ComponentType = { ActionRow: 1, Button: 2, StringSelect: 3, TextInput: 4, UserSelect: 5, RoleSelect: 6, MentionableSelect: 7, ChannelSelect: 8 } as const;
export const ButtonStyle = { Primary: 1, Secondary: 2, Success: 3, Danger: 4, Link: 5 } as const;
export const TextInputStyle = { Short: 1, Paragraph: 2 } as const;

export type Button =
  { type: 2; label?: string; emoji?: Emoji; disabled?: boolean } &
  ({ style: 1 | 2 | 3 | 4; custom_id: string; url?: never } | { style: 5; url: string; custom_id?: never });

export interface SelectOption {
  label: string;
  value: string;
  description?: string;
  emoji?: Emoji;
  default?: boolean;
}

export interface SelectMenu {
  type: 3 | 5 | 6 | 7 | 8;
  custom_id: string;
  placeholder?: string;
  min_values?: number;
  max_values?: number;
  disabled?: boolean;
  options?: readonly SelectOption[];
  channel_types?: readonly number[];
  default_values?: readonly { id: string; type: 'user' | 'role' | 'channel' }[];
}

export interface ActionRow {
  [key: string]: unknown;
  type: 1;
  components: readonly Button[] | readonly [SelectMenu];
}

export interface TextInput {
  type: 4;
  style: 1 | 2;
  custom_id: string;
  label: string;
  placeholder?: string;
  value?: string;
  min_length?: number;
  max_length?: number;
  required?: boolean;
}

export interface ModalRow {
  [key: string]: unknown;
  type: 1;
  components: readonly [TextInput];
}

const size = (value?: string) => value === undefined ? 0 : [...value].length;

function checkId(value?: string): void {
  if (!value || Buffer.byteLength(value) > 100) throw new RangeError('Micup component IDs must contain 1 to 100 bytes');
}

export function actionRow(...buttons: readonly Button[]): ActionRow {
  if (!buttons.length || buttons.length > 5) throw new RangeError('An action row needs one to five buttons');
  for (const button of buttons) {
    if (button.type !== 2 || ![1, 2, 3, 4, 5].includes(button.style) ||
        (!button.label && !button.emoji) || size(button.label) > 80) throw new TypeError('Invalid Micup button');
    if (button.style === 5) {
      if (!button.url || !URL.canParse(button.url) || !['http:', 'https:'].includes(new URL(button.url).protocol) || button.custom_id) {
        throw new TypeError('Link buttons require an HTTP(S) URL');
      }
    } else {
      checkId(button.custom_id);
      if (button.url) throw new TypeError('Interactive buttons use a custom ID');
    }
  }
  return { type: 1, components: structuredClone(buttons) };
}

export function selectRow(menu: SelectMenu): ActionRow {
  checkId(menu.custom_id);
  const { options, min_values: min = 1, max_values: max = 1 } = menu;
  if (![3, 5, 6, 7, 8].includes(menu.type) || size(menu.placeholder) > 150 ||
      !Number.isInteger(min) || !Number.isInteger(max) || min < 0 || max < 1 || min > max || max > 25 ||
      (menu.type === 3 ? !options?.length || options.length > 25 || max > options.length : options?.length) ||
      (menu.type !== 8 && menu.channel_types?.length)) {
    throw new TypeError('Invalid Micup select menu');
  }
  const values = new Set<string>();
  for (const option of options ?? []) {
    if (!option.label || size(option.label) > 100 || !option.value || size(option.value) > 100 ||
        size(option.description) > 100 || values.has(option.value)) {
      throw new TypeError('Invalid or duplicated Micup select option');
    }
    values.add(option.value);
  }
  return { type: 1, components: [structuredClone(menu)] };
}

export function disableComponents(rows: readonly ActionRow[]): ActionRow[] {
  return Array.from(rows, (row) => ({
    ...row,
    components: Array.from(row.components as readonly (Button | SelectMenu)[], (original) => {
      const component = structuredClone(original);
      if (component.type !== 2 || component.style !== 5) component.disabled = true;
      return component;
    }) as unknown as ActionRow['components'],
  }));
}

export function modalRows(...inputs: readonly TextInput[]): ModalRow[] {
  if (!inputs.length || inputs.length > 5) throw new RangeError('A modal needs one to five text inputs');
  const ids = new Set<string>();
  return inputs.map((input) => {
    checkId(input.custom_id);
    const { min_length: min = 0, max_length: max = 4000 } = input;
    if (input.type !== 4 || ![1, 2].includes(input.style) || !input.label || size(input.label) > 45 ||
        size(input.placeholder) > 100 || size(input.value) > max || ids.has(input.custom_id) ||
        !Number.isInteger(min) || !Number.isInteger(max) || min < 0 || max < 1 || max > 4000 || min > max) {
      throw new TypeError('Invalid or duplicated Micup text input');
    }
    ids.add(input.custom_id);
    return { type: 1, components: [structuredClone(input)] };
  });
}
