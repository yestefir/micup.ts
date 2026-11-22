import { guildPath, type AuditOptions } from './guilds.js';
import { snowflake } from './messages.js';
import type { MicupRequestOptions, RestTransport } from './transport.js';

export interface MicupSoundboardSound {
  id: string;
  guild_id: string;
  creator_id: string;
  name: string;
  asset_hash: string;
  extension: string;
  size_bytes: number;
  duration_ms: number;
  volume: number;
  created_at: string;
  version: number;
  url: string;
}

export type AudioInput = string | Uint8Array;

export interface SoundboardSoundInput {
  name: string;
  audio: AudioInput;
  volume?: number;
}

export interface SoundboardSoundEdit {
  name?: string;
  volume?: number;
}

export interface SoundboardPlayOptions extends MicupRequestOptions {
  sessionId: string;
  connectionId: string;
}

const maxAudioBytes = 512_000;

export function encodeAudio(audio: AudioInput, label = 'Audio'): string {
  if (typeof audio === 'string') {
    if (!audio || audio.startsWith('data:') || audio.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(audio)) {
      throw new TypeError(label + ' must be base64 without a data URL prefix');
    }
    const padding = audio.endsWith('==') ? 2 : audio.endsWith('=') ? 1 : 0;
    if (audio.length / 4 * 3 - padding > maxAudioBytes) throw new RangeError(label + ' is larger than 512000 bytes');
    return audio;
  }
  if (!(audio instanceof Uint8Array) || !audio.byteLength) throw new TypeError(label + ' must be a base64 string or bytes');
  if (audio.byteLength > maxAudioBytes) throw new RangeError(label + ' is larger than 512000 bytes');
  return Buffer.from(audio.buffer, audio.byteOffset, audio.byteLength).toString('base64');
}

function soundName(name: string): string {
  const length = typeof name === 'string' ? [...name].length : 0;
  if (length < 1 || length > 32) throw new RangeError('A soundboard sound name takes 1 to 32 characters');
  return name;
}

function soundVolume(volume: number): number {
  if (!Number.isFinite(volume) || volume < 0 || volume > 1) throw new RangeError('Soundboard volume must be between 0 and 1');
  return volume;
}

function channelPath(id: string): string {
  return '/channels/' + snowflake(id, 'Channel ID');
}

function soundInput(input: SoundboardSoundInput): SoundboardSoundInput {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('A soundboard sound input must be an object');
  for (const field of Object.keys(input)) {
    if (!['name', 'audio', 'volume'].includes(field)) throw new TypeError('Unsupported soundboard sound field: ' + field);
  }
  return input;
}

function soundEdit(input: SoundboardSoundEdit): SoundboardSoundEdit {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('A soundboard sound edit must be an object');
  for (const field of Object.keys(input)) {
    if (!['name', 'volume'].includes(field)) throw new TypeError('Unsupported soundboard sound edit field: ' + field);
  }
  return input;
}

export class MicupSounds {
  constructor(private readonly rest: RestTransport) {}

  async list(guildId: string, options?: MicupRequestOptions): Promise<MicupSoundboardSound[]> {
    const { sounds } = await this.rest.request<{ sounds: MicupSoundboardSound[] }>('GET', guildPath(guildId) + '/soundboard-sounds', options);
    return sounds;
  }

  create(guildId: string, input: SoundboardSoundInput, options?: MicupRequestOptions): Promise<MicupSoundboardSound> {
    const { name, audio, volume } = soundInput(input);
    return this.rest.request('POST', guildPath(guildId) + '/soundboard-sounds', {
      ...options,
      body: {
        name: soundName(name),
        audio: encodeAudio(audio),
        ...(volume !== undefined && { volume: soundVolume(volume) }),
      },
    });
  }

  edit(guildId: string, soundId: string, input: SoundboardSoundEdit, options?: MicupRequestOptions): Promise<MicupSoundboardSound> {
    const { name, volume } = soundEdit(input);
    if (name === undefined && volume === undefined) throw new TypeError('A soundboard sound edit needs a name or a volume');
    return this.rest.request('PATCH', guildPath(guildId) + '/soundboard-sounds/' + snowflake(soundId, 'Sound ID'), {
      ...options,
      body: {
        ...(name !== undefined && { name: soundName(name) }),
        ...(volume !== undefined && { volume: soundVolume(volume) }),
      },
    });
  }

  delete(guildId: string, soundId: string, options?: MicupRequestOptions): Promise<void> {
    return this.rest.request('DELETE', guildPath(guildId) + '/soundboard-sounds/' + snowflake(soundId, 'Sound ID'), options);
  }

  play(channelId: string, soundId: string, { sessionId, connectionId, ...options }: SoundboardPlayOptions): Promise<void> {
    for (const [value, label] of [[sessionId, 'Session ID'], [connectionId, 'Connection ID']] as const) {
      if (typeof value !== 'string' || value.length < 1 || value.length > 128) throw new TypeError(label + ' must take 1 to 128 characters');
    }
    return this.rest.request('POST', channelPath(channelId) + '/soundboard-sounds/' + snowflake(soundId, 'Sound ID') + '/play', {
      ...options,
      body: { session_id: sessionId, connection_id: connectionId },
    });
  }

  setGuildNotification(guildId: string, audio: AudioInput, options?: AuditOptions): Promise<void> {
    return this.rest.request('PUT', guildPath(guildId) + '/notification-sound', { ...options, body: { audio: encodeAudio(audio) } });
  }

  clearGuildNotification(guildId: string, options?: AuditOptions): Promise<void> {
    return this.rest.request('DELETE', guildPath(guildId) + '/notification-sound', options);
  }

  setChannelNotification(channelId: string, audio: AudioInput, options?: AuditOptions): Promise<void> {
    return this.rest.request('PUT', channelPath(channelId) + '/notification-sound', { ...options, body: { audio: encodeAudio(audio) } });
  }

  clearChannelNotification(channelId: string, options?: AuditOptions): Promise<void> {
    return this.rest.request('DELETE', channelPath(channelId) + '/notification-sound', options);
  }
}
