import { spawn } from 'node:child_process';
import { channels, sampleRate } from './pcm.js';

export interface AudioSourceOptions {
  ffmpeg?: string;
  startSeconds?: number;
  signal?: AbortSignal;
}

export interface AudioSource extends AsyncIterable<Uint8Array> {
  close(): Promise<void>;
}

export function openSource(input: string, options: AudioSourceOptions = {}): AudioSource {
  const { ffmpeg = 'ffmpeg', startSeconds = 0, signal } = options;
  if (!input || input.startsWith('-') || input.includes('\0')) {
    throw new TypeError('Audio input must be a file path or HTTP(S) URL');
  }
  if (!Number.isFinite(startSeconds) || startSeconds < 0) {
    throw new RangeError('Audio start position must be a nonnegative number');
  }
  const remote = /^https?:\/\//i.test(input);
  if (!remote && /^[a-z][a-z0-9+.-]*:/i.test(input) && !/^[a-z]:[/\\]/i.test(input)) {
    throw new TypeError('Audio input must be a file path or HTTP(S) URL');
  }
  signal?.throwIfAborted();
  const protocols = remote ? 'http,https,tcp,tls,crypto' : 'file';
  const args = ['-hide_banner', '-loglevel', 'error', '-nostdin', '-protocol_whitelist', protocols];
  if (startSeconds) args.push('-ss', String(startSeconds));
  args.push('-i', input, '-vn', '-f', 's16le', '-ar', String(sampleRate), '-ac', String(channels), 'pipe:1');
  const process = spawn(ffmpeg, args, { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
  let closed = false;
  let started = false;
  let spawnFailed = false;

  const terminate = () => {
    closed = true;
    process.stdout.destroy();
    if (process.exitCode === null && !process.killed) process.kill();
  };
  const completed = new Promise<number | null>((resolve) => {
    process.once('error', () => { spawnFailed = true; });
    process.once('close', (code) => {
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
        for await (const chunk of process.stdout) yield chunk;
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
