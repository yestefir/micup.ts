export const GatewayOpcode = {
  Dispatch: 0,
  Heartbeat: 1,
  Identify: 2,
  PresenceUpdate: 3,
  VoiceStateUpdate: 4,
  Resume: 6,
  Reconnect: 7,
  RequestGuildMembers: 8,
  InvalidSession: 9,
  Hello: 10,
  HeartbeatAck: 11,
  GatewayError: 12,
  VoiceSignal: 13,
  LazyRequest: 14,
  RequestGuildCounts: 15,
  RequestChannelMemberCounts: 16,
  RequestForumUnreads: 28,
} as const;

const fatalCloseCodes = new Set([4001, 4002, 4003, 4004, 4005, 4010, 4011, 4012]);

export class GatewayCloseError extends Error {
  constructor(readonly code: number, readonly reason: string) {
    super('Micup Gateway closed with code ' + code + (reason ? ': ' + reason : ''));
    this.name = 'GatewayCloseError';
  }

  get fatal(): boolean {
    return fatalCloseCodes.has(this.code);
  }

  get resetsSession(): boolean {
    return this.code === 4007 || this.code === 4009;
  }
}

export interface GatewayDispatch {
  readonly name: string;
  readonly data: unknown;
  readonly sequence: number | null;
  readonly shardId: number;
}

export interface GatewayPacket {
  op: number;
  d?: unknown;
  s?: number | null;
  t?: string;
}

export function decodePacket(data: string): GatewayPacket {
  const packet = JSON.parse(data);
  if (!packet || !Number.isInteger(packet.op)) {
    throw new Error('Invalid Micup Gateway packet');
  }
  if (packet.op === GatewayOpcode.Dispatch && (
    typeof packet.t !== 'string' || !packet.t ||
    (packet.s != null && (!Number.isSafeInteger(packet.s) || packet.s < 0))
  )) {
    throw new Error('Invalid Micup Gateway dispatch');
  }
  return packet;
}

export function gatewayEndpoint(raw: string): URL {
  const endpoint = new URL(raw);
  if (!['ws:', 'wss:'].includes(endpoint.protocol) || endpoint.username ||
      endpoint.password || endpoint.hash) {
    throw new TypeError('Invalid Micup Gateway endpoint');
  }
  endpoint.searchParams.set('v', '1');
  endpoint.searchParams.set('encoding', 'json');
  endpoint.searchParams.delete('compress');
  endpoint.searchParams.delete('stream');
  return endpoint;
}
