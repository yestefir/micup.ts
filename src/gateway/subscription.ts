export interface GatewaySubscription {
  active?: boolean;
  sync?: boolean;
  typing?: boolean;
  member_list_channels?: Readonly<Record<string, readonly (readonly [start: number, end: number])[]>>;
  members?: readonly string[];
  threads?: boolean;
  thread_member_lists?: readonly string[];
}

const validId = (value: string) => typeof value === 'string' && /^\d+$/.test(value);

export function validateSubscriptions(subscriptions: Readonly<Record<string, GatewaySubscription>>): void {
  const entries = Object.entries(subscriptions ?? {});
  if (!entries.length) throw new TypeError('At least one guild subscription is required');
  for (const [id, subscription] of entries) {
    if (!validId(id) || !subscription || typeof subscription !== 'object') throw new TypeError('Invalid guild subscription');
    if ((subscription.members?.length ?? 0) > 1000 || subscription.members?.some((member) => !validId(member)) ||
        (subscription.thread_member_lists?.length ?? 0) > 10 ||
        subscription.thread_member_lists?.some((thread) => !validId(thread))) {
      throw new RangeError('Invalid subscription member or thread IDs');
    }
    for (const [channel, ranges] of Object.entries(subscription.member_list_channels ?? {})) {
      if (!validId(channel) || !Array.isArray(ranges) || ranges.length > 10) {
        throw new RangeError('Invalid member list subscription');
      }
      for (const range of ranges) {
        if (range.length !== 2 || !Number.isSafeInteger(range[0]) || !Number.isSafeInteger(range[1]) ||
            range[0] < 0 || range[1] < range[0] || range[1] > 100000 || range[1] - range[0] >= 100) {
          throw new RangeError('Member list ranges must cover at most 100 members within 0 to 100000');
        }
      }
    }
  }
}
