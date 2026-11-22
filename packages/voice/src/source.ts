import { spawn } from 'node:child_process';
import type { Readable } from 'node:stream';
import { channels, sampleRate } from './pcm.js';

export interface AudioSourceOptions {
  ffmpeg?: string;
  startSeconds?: number;
  ffmpegArgs?: readonly string[];
  signal?: AbortSignal;
}

export interface AudioInputStream {
  pipe(destination: any): unknown;
  unpipe(destination?: any): unknown;
  destroy(error?: Error): unknown;
  on(event: 'error', listener: (error: Error) => void): unknown;
}

export interface AudioSource extends AsyncIterable<Uint8Array> {
  close(): Promise<void>;
}

const reconnectArgs = ['-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '5'];

function isReadable(input: unknown): input is Readable {
  return typeof input === 'object' && input !== null && typeof (input as Readable).pipe === 'function' && typeof (input as Readable).on === 'function';
}

export function openSource(input: string | AudioInputStream, options: AudioSourceOptions = {}): AudioSource {
  const { ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg', startSeconds = 0, ffmpegArgs = [], signal } = options;
  const stream = isReadable(input);
  if (!stream && (typeof input !== 'string' || !input || input.startsWith('-') || input.includes('\0'))) {
    throw new TypeError('Audio input must be a file path, an HTTP(S) URL or a readable stream');
  }
  if (!Number.isFinite(startSeconds) || startSeconds < 0) {
    throw new RangeError('Audio start position must be a nonnegative number');
  }
  if (!Array.isArray(ffmpegArgs) || ffmpegArgs.some((arg) => typeof arg !== 'string' || arg.includes('\0'))) {
    throw new TypeError('FFmpeg arguments must be strings');
  }
  const remote = !stream && /^https?:\/\//i.test(input as string);
  if (!stream && !remote && /^[a-z][a-z0-9+.-]*:/i.test(input as string) && !/^[a-z]:[/\\]/i.test(input as string)) {
    throw new TypeError('Audio input must be a file path, an HTTP(S) URL or a readable stream');
  }
  signal?.throwIfAborted();
  const protocols = stream ? 'pipe' : remote ? 'http,https,tcp,tls,crypto' : 'file';
  const args = ['-hide_banner', '-loglevel', 'error', '-nostdin', '-protocol_whitelist', protocols];
  if (startSeconds) args.push('-ss', String(startSeconds));
  if (remote) args.push(...reconnectArgs);
  args.push('-i', stream ? 'pipe:0' : input as string, ...ffmpegArgs, '-vn', '-f', 's16le', '-ar', String(sampleRate), '-ac', String(channels), 'pipe:1');
  const child = spawn(ffmpeg, args, { stdio: [stream ? 'pipe' : 'ignore', 'pipe', 'ignore'], windowsHide: true });
  const stdout = child.stdout!;
  let closed = false;
  let started = false;
  let spawnFailed = false;

  if (stream) {
    const upstream = input as Readable;
    child.stdin!.on('error', () => {});
    upstream.on('error', () => child.stdin!.destroy());
    upstream.pipe(child.stdin!);
  }

  const terminate = () => {
    closed = true;
    if (stream) {
      (input as Readable).unpipe(child.stdin!);
      (input as Readable).destroy();
      child.stdin!.destroy();
    }
    stdout.destroy();
    if (child.exitCode === null && !child.killed) child.kill();
  };
  const completed = new Promise<number | null>((resolve) => {
    child.once('error', () => { spawnFailed = true; });
    child.once('close', (code) => {
      signal?.removeEventListener('abort', terminate);
      resolve(code);
    });
  });
  signal?.addEventListener('abort', terminate, { once: true });
  if (signal?.aborted) terminate();

  return {
    async *[Symbol.asyncIterator]() {
      if (started) throw new Error('Audio source has already been consumed');
      started = true;
      try {
        for await (const chunk of stdout) yield chunk;
        const code = await completed;
        signal?.throwIfAborted();
        if (spawnFailed) throw new Error('FFmpeg could not be started');
        if (code !== 0 && !closed) throw new Error('FFmpeg failed to decode the audio source');
      } finally {
        terminate();
        await completed;
      }
    },
    async close() {
      terminate();
      await completed;
    },
  };
}
