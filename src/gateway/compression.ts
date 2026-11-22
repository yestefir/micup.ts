import { Buffer } from 'node:buffer';
import * as zlib from 'node:zlib';
import type { RawData } from 'ws';

const maxPacketBytes = 8 * 1024 * 1024;
const utf8 = new TextDecoder('utf-8', { fatal: true });

class JsonPackets {
  #parts: Buffer[] = [];
  #length = 0;
  #depth = 0;
  #quoted = false;
  #escape = false;

  push(chunk: Buffer, emit: (text: string) => void, signal: AbortSignal): void {
    let start = 0;

    for (let i = 0; i < chunk.length && !signal.aborted; i++) {
      const byte = chunk[i];
      if (this.#depth === 0) {
        if (byte === 32 || byte === 9 || byte === 10 || byte === 13) {
          start = i + 1;
          continue;
        }
        if (byte !== 123) throw new Error('Invalid Micup Gateway JSON stream');
        this.#depth = 1;
      } else if (this.#quoted) {
        if (this.#escape) this.#escape = false;
        else if (byte === 92) this.#escape = true;
        else if (byte === 34) this.#quoted = false;
      } else if (byte === 34) {
        this.#quoted = true;
      } else if (byte === 123 || byte === 91) {
        this.#depth++;
      } else if (byte === 125 || byte === 93) {
        this.#depth--;
        if (this.#depth === 0) {
          this.#append(chunk.subarray(start, i + 1));
          const packet = utf8.decode(Buffer.concat(this.#parts, this.#length));
          this.#parts = [];
          this.#length = 0;
          start = i + 1;
          emit(packet);
        }
      }
    }

    if (this.#depth !== 0 && !signal.aborted) this.#append(chunk.subarray(start));
  }

  #append(slice: Buffer): void {
    this.#length += slice.length;
    if (this.#length > maxPacketBytes) throw new RangeError('Micup Gateway packet exceeds 8 MiB after decompression');
    if (slice.length) this.#parts.push(slice);
  }
}

export function assertZstdAvailable(): void {
  if (typeof zlib.createZstdCompress !== 'function' || typeof zlib.createZstdDecompress !== 'function') {
    throw new Error('Micup zstd-stream requires Node.js 24 or later with native Zstandard support');
  }
}

export class GatewayCompression {
  readonly #encoder = zlib.createZstdCompress();
  readonly #decoder = zlib.createZstdDecompress({
    params: { [zlib.constants.ZSTD_d_windowLogMax]: 26 },
  });
  readonly #packets = new JsonPackets();
  #chunks: Buffer[] = [];
  #signal: AbortSignal;
  #error: (error: unknown) => void;
  #sending: Promise<void> = Promise.resolve();

  constructor(
    signal: AbortSignal,
    receive: (packet: string) => void,
    error: (error: unknown) => void,
    resume: () => void,
  ) {
    this.#signal = signal;
    this.#error = error;
    this.#encoder.on('data', (chunk: Buffer) => this.#chunks.push(chunk));
    this.#encoder.on('error', error);
    this.#decoder.on('error', error);
    this.#decoder.on('drain', resume);
    this.#decoder.on('data', (chunk: Buffer) => {
      try {
        this.#packets.push(chunk, receive, signal);
      } catch (cause) {
        error(cause);
      }
    });
  }

  receive(data: RawData): boolean {
    const input = Array.isArray(data) ? Buffer.concat(data) : Buffer.isBuffer(data) ? data : Buffer.from(data);
    return this.#decoder.write(input);
  }

  send(text: string, write: (data: Buffer) => void, caller?: AbortSignal): Promise<void> {
    const task = this.#sending.then(async () => {
      this.#signal.throwIfAborted();
      caller?.throwIfAborted();
      let encodingStarted = false;
      let callerAbortReported = false;
      const invalidateCallerAbort = () => {
        if (!encodingStarted || !caller?.aborted || this.#signal.aborted || callerAbortReported) return;
        callerAbortReported = true;
        try {
          this.#error(new Error('Micup Gateway compression was interrupted during a send', { cause: caller.reason }));
        } catch {}
      };
      await new Promise<void>((resolve, reject) => {
        let settled = false;
        const cleanup = () => {
          this.#signal.removeEventListener('abort', abort);
          caller?.removeEventListener('abort', abort);
        };
        const abort = () => {
          if (settled) return;
          settled = true;
          cleanup();
          invalidateCallerAbort();
          reject(caller?.aborted ? caller.reason : this.#signal.reason);
        };
        const flushed = () => {
          if (settled) return;
          settled = true;
          cleanup();
          resolve();
        };
        this.#signal.addEventListener('abort', abort, { once: true });
        caller?.addEventListener('abort', abort, { once: true });
        if (this.#signal.aborted || caller?.aborted) {
          abort();
          return;
        }
        encodingStarted = true;
        this.#encoder.write(text);
        this.#encoder.flush(zlib.constants.ZSTD_e_flush, flushed);
      });
      try {
        this.#signal.throwIfAborted();
        caller?.throwIfAborted();
      } catch (error) {
        invalidateCallerAbort();
        throw error;
      }
      const frame = Buffer.concat(this.#chunks);
      this.#chunks = [];
      write(frame);
    });
    this.#sending = task.catch(() => {});
    return task;
  }

  destroy(): void {
    this.#encoder.destroy();
    this.#decoder.destroy();
    this.#chunks = [];
  }
}
