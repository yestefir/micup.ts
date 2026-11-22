import { setTimeout as delay } from 'node:timers/promises';
import WebSocket, { type RawData } from 'ws';
import { decodePacket, GatewayCloseError, GatewayOpcode, type GatewayDispatch, type GatewayPacket } from './protocol.js';

export interface GatewayResume {
  sessionId?: string;
  sequence: number | null;
}

interface ConnectionOptions {
  endpoint: URL;
  token: string;
  shard: readonly [number, number];
  ignoredEvents: readonly string[];
  flags: number;
  resume: GatewayResume;
  beforeIdentify?: (signal: AbortSignal) => Promise<void>;
  dispatch: (event: GatewayDispatch, signal: AbortSignal) => Promise<void>;
  receive: (event: GatewayDispatch) => void;
  onInvalidate: () => void;
  onReady: (resumed: boolean) => void;
  onGatewayError?: (data: unknown) => void;
}

class CommandWindow {
  readonly #timestamps: number[] = [];

  constructor(private readonly capacity: number, private readonly duration: number) {}

  async acquire(signal: AbortSignal): Promise<void> {
    while (true) {
      signal.throwIfAborted();
      const now = performance.now();
      while (this.#timestamps[0] <= now - this.duration) {
        this.#timestamps.shift();
      }
      if (this.#timestamps.length < this.capacity) {
        this.#timestamps.push(now);
        return;
      }
      await delay(Math.ceil(this.#timestamps[0] + this.duration - now), undefined, { signal });
    }
  }
}

export class GatewayConnection {
  readonly #socket: WebSocket;
  readonly #lifetime = new AbortController();
  readonly #commands = new CommandWindow(540, 60_000);
  readonly #presence = new CommandWindow(5, 20_000);
  readonly #dispatches: GatewayPacket[] = [];
  #helloTimer?: ReturnType<typeof setTimeout>;
  #heartbeat?: ReturnType<typeof setInterval>;
  #pendingHeartbeat?: number;
  #authenticated = false;
  #authenticating = false;
  #draining = false;
  #generation = new AbortController();
  #latency?: number;

  private constructor(private readonly options: ConnectionOptions) {
    this.#socket = new WebSocket(options.endpoint, {
      maxPayload: 8 * 1024 * 1024,
      handshakeTimeout: 10_000,
      followRedirects: false,
      perMessageDeflate: false,
      headers: { 'User-Agent': 'micup.ts' },
    });
  }

  static async run(
    options: ConnectionOptions,
    signal: AbortSignal,
    onConnect: (connection: GatewayConnection) => void,
  ): Promise<void> {
    signal.throwIfAborted();
    if (!options.resume.sessionId || options.resume.sequence === null) {
      await options.beforeIdentify?.(signal);
      signal.throwIfAborted();
    }
    const connection = new GatewayConnection(options);
    onConnect(connection);
    await connection.#read(signal);
  }

  get latency(): number | undefined {
    return this.#latency;
  }

  async send(opcode: number, data: unknown, signal?: AbortSignal): Promise<void> {
    const lifetime = this.#lifetime.signal;
    const combined = signal ? AbortSignal.any([signal, lifetime]) : lifetime;
    const payload = this.#encode(opcode, data);
    if (opcode === GatewayOpcode.PresenceUpdate) {
      await this.#presence.acquire(combined);
    }
    await this.#commands.acquire(combined);
    combined.throwIfAborted();
    this.#write(payload);
  }

  #read(signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      const finish = (error?: unknown) => {
        if (this.#lifetime.signal.aborted) return;
        signal.removeEventListener('abort', onAbort);
        this.#lifetime.abort(error);
        this.#generation.abort(error);
        this.#dispatches.length = 0;
        clearTimeout(this.#helloTimer);
        clearInterval(this.#heartbeat);
        this.#socket.terminate();
        if (error === undefined || signal.aborted) resolve();
        else reject(error);
      };
      const onAbort = () => finish();
      this.#socket.on('error', () => finish(new Error('Micup Gateway connection failed')));
      this.#socket.on('close', (code, reason) => finish(new GatewayCloseError(code, reason.toString())));
      this.#socket.on('message', (data, binary) => {
        if (this.#lifetime.signal.aborted) return;
        try {
          this.#receive(data, binary, finish);
        } catch (error) {
          finish(error);
        }
      });
      this.#helloTimer = setTimeout(() => finish(new Error('Micup Gateway HELLO timed out')), 10_000);
      signal.addEventListener('abort', onAbort, { once: true });
      if (signal.aborted) onAbort();
    });
  }

  #receive(raw: RawData, binary: boolean, finish: (error?: unknown) => void): void {
    if (binary) throw new Error('Unexpected binary Micup Gateway packet');
    const packet = decodePacket(raw.toString());
    const op = GatewayOpcode;
    switch (packet.op) {
      case op.Hello: {
        if (this.#heartbeat) throw new Error('Duplicate Micup Gateway HELLO');
        const interval = (packet.d as { heartbeat_interval?: unknown } | null)?.heartbeat_interval;
        if (typeof interval !== 'number' || !Number.isFinite(interval) || interval < 100 ||
            interval > 2_147_483_647) {
          throw new Error('Invalid Micup Gateway heartbeat interval');
        }
        clearTimeout(this.#helloTimer);
        this.#heartbeat = setInterval(() => {
          try {
            if (this.#pendingHeartbeat !== undefined) throw new Error('Micup Gateway heartbeat timed out');
            this.#beat();
          } catch (error) {
            finish(error);
          }
        }, interval);
        this.#authenticate(false).catch(finish);
        break;
      }
      case op.Heartbeat:
        this.#beat();
        break;
      case op.HeartbeatAck:
        if (this.#pendingHeartbeat !== undefined) {
          this.#latency = performance.now() - this.#pendingHeartbeat;
          this.#pendingHeartbeat = undefined;
        }
        break;
      case op.Reconnect:
        finish(new Error('Micup Gateway requested reconnect'));
        break;
      case op.InvalidSession:
        if (!this.#authenticated) throw new Error('Unexpected Micup Gateway invalid session');
        this.#authenticated = false;
        this.options.resume.sessionId = undefined;
        this.options.resume.sequence = null;
        this.#generation.abort();
        this.#generation = new AbortController();
        this.#dispatches.length = 0;
        this.options.onInvalidate();
        this.#authenticate(true).catch(finish);
        break;
      case op.GatewayError:
        this.options.onGatewayError?.(packet.d);
        break;
      case op.Dispatch:
        if (!this.#authenticated) throw new Error('Micup Gateway dispatched before authentication');
        if (this.#dispatches.length >= 1024) throw new Error('Micup Gateway event queue is full');
        this.options.receive(this.#dispatch(packet));
        this.#dispatches.push(packet);
        this.#drain(finish).catch(finish);
        break;
    }
  }

  async #authenticate(waitForIdentify: boolean): Promise<void> {
    if (this.#authenticating) throw new Error('Micup Gateway authentication is already pending');
    this.#authenticating = true;
    try {
      const { resume, token, shard, flags, ignoredEvents } = this.options;
      if (resume.sessionId && resume.sequence !== null) {
        this.#write(this.#encode(GatewayOpcode.Resume, {
          token, session_id: resume.sessionId, seq: resume.sequence,
        }));
      } else {
        if (waitForIdentify) await this.options.beforeIdentify?.(this.#lifetime.signal);
        this.#lifetime.signal.throwIfAborted();
        this.#write(this.#encode(GatewayOpcode.Identify, {
          token,
          properties: { os: process.platform, browser: 'micup.ts', device: 'micup.ts' },
          shard,
          ...(flags ? { flags } : {}),
          ...(ignoredEvents.length ? { ignored_events: ignoredEvents } : {}),
        }));
      }
      this.#authenticated = true;
    } finally {
      this.#authenticating = false;
    }
  }

  async #drain(finish: (error?: unknown) => void): Promise<void> {
    if (this.#draining) return;
    this.#draining = true;
    try {
      while (!this.#lifetime.signal.aborted) {
        const packet = this.#dispatches.shift();
        if (!packet) return;
        const signal = this.#generation.signal;
        const name = packet.t!;
        const sequence = packet.s ?? null;
        try {
          if (name === 'READY') {
            this.options.resume.sessionId = undefined;
            this.options.resume.sequence = null;
          }
          await this.options.dispatch(this.#dispatch(packet), signal);
          if (signal.aborted) continue;
          if (name === 'READY') {
            const id = (packet.d as { session_id?: unknown } | null)?.session_id;
            if (typeof id !== 'string' || !id) throw new Error('Micup READY omitted the session ID');
            this.options.resume.sessionId = id;
          }
          if (sequence !== null) this.options.resume.sequence = sequence;
          if (name === 'READY' || name === 'RESUMED') this.options.onReady(name === 'RESUMED');
        } catch (error) {
          if (!signal.aborted) {
            finish(error ?? new Error('Micup Gateway handler failed'));
            return;
          }
        }
      }
    } finally {
      this.#draining = false;
    }
  }

  #dispatch(packet: GatewayPacket): GatewayDispatch {
    return { name: packet.t!, sequence: packet.s ?? null, data: packet.d, shardId: this.options.shard[0] };
  }

  #beat(): void {
    this.#pendingHeartbeat ??= performance.now();
    this.#write(this.#encode(GatewayOpcode.Heartbeat, this.options.resume.sequence));
  }

  #encode(op: number, d: unknown): string {
    if (!Number.isSafeInteger(op) || op < 0) throw new TypeError('Invalid Micup Gateway opcode');
    const payload = JSON.stringify({ op, d });
    if (Buffer.byteLength(payload) > 16_384) throw new RangeError('Micup Gateway payload exceeds 16,384 bytes');
    return payload;
  }

  #write(payload: string): void {
    if (this.#socket.readyState !== WebSocket.OPEN) throw new Error('Micup Gateway is disconnected');
    this.#socket.send(payload);
  }
}
