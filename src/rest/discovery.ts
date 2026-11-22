import { guildPath } from './guilds.js';
import type { MicupRequestOptions, RestTransport } from './transport.js';

export type DiscoveryApplicationStatus = 'pending' | 'approved' | 'rejected' | 'removed';

export interface DiscoveryApplication {
  guild_id: string;
  status: DiscoveryApplicationStatus | string;
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

function check({ description, category_type, primary_language, custom_tags }: DiscoveryApplicationEdit): void {
  if (description !== undefined && (typeof description !== 'string' || [...description].length < 10 || [...description].length > 300)) {
    throw new RangeError('A discovery description takes 10 to 300 characters');
  }
  if (category_type !== undefined && !Number.isSafeInteger(category_type)) throw new TypeError('A discovery category is an integer');
  if (primary_language !== undefined && typeof primary_language !== 'string') throw new TypeError('A discovery language must be a string');
  if (custom_tags !== undefined && (!Array.isArray(custom_tags) || custom_tags.some((tag: unknown) => typeof tag !== 'string'))) {
    throw new TypeError('Discovery custom tags must be an array of strings');
  }
  if (custom_tags !== undefined && custom_tags.length > 10) throw new RangeError('A discovery listing takes up to 10 custom tags');
}

export class MicupDiscovery {
  constructor(private readonly rest: RestTransport) {}

  status(guildId: string, options?: MicupRequestOptions): Promise<DiscoveryStatus> {
    return this.rest.request('GET', guildPath(guildId) + '/discovery', options);
  }

  apply(guildId: string, application: DiscoveryApplicationInput, options?: MicupRequestOptions): Promise<DiscoveryApplication> {
    if (application.description === undefined || application.category_type === undefined) {
      throw new TypeError('A discovery application needs a description and a category');
    }
    check(application);
    return this.rest.request('POST', guildPath(guildId) + '/discovery', { ...options, body: application });
  }

  edit(guildId: string, edit: DiscoveryApplicationEdit, options?: MicupRequestOptions): Promise<DiscoveryApplication> {
    check(edit);
    return this.rest.request('PATCH', guildPath(guildId) + '/discovery', { ...options, body: edit });
  }

  withdraw(guildId: string, options?: MicupRequestOptions): Promise<void> {
    return this.rest.request('DELETE', guildPath(guildId) + '/discovery', options);
  }
}
