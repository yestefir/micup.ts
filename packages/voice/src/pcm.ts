export const sampleRate = 48_000;
export const channels = 2;
export const frameDurationMs = 20;
export const samplesPerFrame = sampleRate * channels * frameDurationMs / 1000;
export const bytesPerFrame = samplesPerFrame * 2;

export function scaleVolume(frame: Int16Array, factor: number): Int16Array {
  if (!Number.isFinite(factor)) throw new RangeError('Volume must be finite');
  const gain = Math.min(2, Math.max(0, factor));
  return frame.map((value) => {
    const scaled = Math.sign(value) * Math.round(Math.abs(value * gain));
    return Math.min(32767, Math.max(-32768, scaled));
  });
}

export interface PCMTrack {
  write(frame: Int16Array, options?: { signal?: AbortSignal }): Promise<void>;
  drain?(options?: { signal?: AbortSignal }): Promise<void>;
  clear?(): void | Promise<void>;
}

export interface VoiceTrackOptions {
  trackName?: string;
  bitrate?: number;
  signal?: AbortSignal;
}

export interface VoiceTrack extends PCMTrack {
  readonly closed: boolean;
  drain(options?: { signal?: AbortSignal }): Promise<void>;
  clear(): Promise<void>;
  close(): Promise<void>;
}
