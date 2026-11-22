import { guildPath } from './guilds.js';
import type { MicupRequestOptions, RestTransport } from './transport.js';

export type DiscoveryApplicationStatus = 'pending' | 'approved' | 'rejected' | 'removed';

export interface DiscoveryApplication {
  guild_id: string;
  status: DiscoveryApplicationStatus | (string & {});
  description: string;
  category_type: number;
  primary_language: string | null;
  custom_tags: string[];
  applied_at: string;
  reviewed_at: string | null;
  review_reason: string | null;
  removed_at: string | null;
  removal_reason: string | null;
}

export interface DiscoveryStatus {
  application: DiscoveryApplication | null;
  eligible: boolean;
  min_member_count: number;
}

export interface DiscoveryApplicationInput {
  description: string;
  category_type: number;
  primary_language?: string;
  custom_tags?: readonly string[];
}

export type DiscoveryApplicationEdit = Partial<DiscoveryApplicationInput>;

const categories = new Set([0, 1, 2, 3, 4, 5, 6, 7, 8]);
const inputFields = new Set(['description', 'category_type', 'primary_language', 'custom_tags']);
const languages = new Set([
  'ar', 'bg', 'cs', 'da', 'de', 'el', 'en-US', 'es-ES', 'es-419', 'fi', 'fr', 'he', 'hi', 'hr', 'hu', 'id', 'it', 'ja', 'ko', 'lt',
  'nl', 'no', 'pl', 'pt-BR', 'ro', 'ru', 'sv-SE', 'th', 'tr', 'uk', 'vi', 'zh-CN', 'zh-TW',
]);

function check(edit: DiscoveryApplicationEdit): void {
  if (!edit || typeof edit !== 'object' || Array.isArray(edit)) throw new TypeError('A discovery application must be an object');
  const fields = Object.keys(edit);
  for (const field of fields) if (!inputFields.has(field)) throw new TypeError('Unsupported discovery application field: ' + field);
  const { description, category_type, primary_language, custom_tags } = edit;
  if (description !== undefined && (typeof description !== 'string' || [...description].length < 10 || [...description].length > 300)) {
    throw new RangeError('A discovery description takes 10 to 300 characters');
  }
  if (category_type !== undefined && !Number.isSafeInteger(category_type)) throw new TypeError('A discovery category is an integer');
  if (category_type !== undefined && !categories.has(category_type)) throw new RangeError('Invalid Micup discovery category');
  if (primary_language !== undefined && (typeof primary_language !== 'string' || !languages.has(primary_language))) {
    throw new TypeError('Invalid Micup discovery language');
  }
  if (custom_tags !== undefined) {
    if (!Array.isArray(custom_tags)) throw new TypeError('Discovery custom tags must be an array of strings');
    for (const tag of custom_tags) {
      if (typeof tag !== 'string') throw new TypeError('Discovery custom tags must be an array of strings');
      const normalized = tag.trim();
      const length = [...normalized].length;
      if (length < 2 || length > 30) throw new RangeError('Discovery custom tags must contain 2 to 30 characters');
      if (!/^[\p{L}\p{N}][\p{L}\p{N} _+&-]*$/u.test(normalized)) throw new TypeError('Invalid Micup discovery custom tag');
    }
  }
  if (custom_tags !== undefined && custom_tags.length > 10) throw new RangeError('A discovery listing takes up to 10 custom tags');
}

function applicationPayload(edit: DiscoveryApplicationEdit): DiscoveryApplicationEdit {
  return Object.fromEntries(Object.entries(edit).filter(([field, value]) => inputFields.has(field) && value !== undefined)) as DiscoveryApplicationEdit;
}

export class MicupDiscovery {
  constructor(private readonly rest: RestTransport) {}

  status(guildId: string, options?: MicupRequestOptions): Promise<DiscoveryStatus> {
    return this.rest.request('GET', guildPath(guildId) + '/discovery', options);
  }

  apply(guildId: string, application: DiscoveryApplicationInput, options?: MicupRequestOptions): Promise<DiscoveryApplication> {
    check(application);
    if (application.description === undefined || application.category_type === undefined) {
      throw new TypeError('A discovery application needs a description and a category');
    }
    return this.rest.request('POST', guildPath(guildId) + '/discovery', { ...options, body: applicationPayload(application) });
  }

  edit(guildId: string, edit: DiscoveryApplicationEdit, options?: MicupRequestOptions): Promise<DiscoveryApplication> {
    check(edit);
    if (Object.keys(edit).length === 0) throw new TypeError('A discovery edit must contain at least one field');
    return this.rest.request('PATCH', guildPath(guildId) + '/discovery', { ...options, body: applicationPayload(edit) });
  }

  withdraw(guildId: string, options?: MicupRequestOptions): Promise<void> {
    return this.rest.request('DELETE', guildPath(guildId) + '/discovery', options);
  }
}
