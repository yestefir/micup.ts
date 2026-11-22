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
  if (!subscriptions || typeof subscriptions !== 'object' || Array.isArray(subscriptions)) {
    throw new TypeError('Guild subscriptions must be an object');
  }
  const entries = Object.entries(subscriptions ?? {});
  if (!entries.length) throw new TypeError('At least one guild subscription is required');
  for (const [id, subscription] of entries) {
    if (!validId(id) || !subscription || typeof subscription !== 'object' || Array.isArray(subscription)) {
      throw new TypeError('Invalid guild subscription');
    }
    const members = subscription.members;
    const threadMembers = subscription.thread_member_lists;
    if (members !== undefined && !Array.isArray(members) || (members?.length ?? 0) > 1000 ||
        threadMembers !== undefined && !Array.isArray(threadMembers) || (threadMembers?.length ?? 0) > 10) {
      throw new RangeError('Invalid subscription member or thread IDs');
    }
    for (const member of members ?? []) {
      if (!validId(member)) throw new RangeError('Invalid subscription member or thread IDs');
    }
    for (const thread of threadMembers ?? []) {
      if (!validId(thread)) throw new RangeError('Invalid subscription member or thread IDs');
    }
    const channelRanges = subscription.member_list_channels;
    if (channelRanges !== undefined && (!channelRanges || typeof channelRanges !== 'object' || Array.isArray(channelRanges))) {
      throw new TypeError('Invalid member list subscription');
    }
    for (const [channel, ranges] of Object.entries(channelRanges ?? {})) {
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
