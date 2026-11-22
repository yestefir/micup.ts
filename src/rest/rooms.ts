import { snowflake } from './messages.js';
import type { MicupRequestOptions, RestTransport } from './transport.js';

export type StageBoardStyle = 'neon' | 'tahta' | 'sade';
export type StageHostCharacter =
  | 'ithp-gunluk' | 'ithp-ceketli' | 'ithp-gozluk' | 'ithp-kulaklik'
  | 'ithp-rahat' | 'ithp-sapkali' | 'ithp-sehirli' | 'ithp-yazlik';
export type StageEffectType = 'confetti' | 'spotlight' | 'host_emote';
export type TournamentGame = 'slap' | 'arm_wrestle';
export type TournamentSize = 4 | 8 | 16 | 32;

export interface StageScore {
  name: string;
  value: number;
  user_id?: string | null;
}

export interface StageBoardInput {
  type: 'board';
  style?: StageBoardStyle;
  title?: string | null;
  text?: string | null;
  accent?: number;
  scores?: readonly StageScore[];
  message_id?: string;
}

export interface StageVideoInput {
  type: 'video';
  url: string;
  position_ms?: number;
  paused?: boolean;
}

export interface StageHostInput {
  character?: StageHostCharacter;
  shirt?: number;
}

export interface VoiceRoomStageInput {
  tv?: StageBoardInput | StageVideoInput | null;
  host?: StageHostInput | null;
  ttl_seconds?: number;
}

export interface VoiceRoomStage {
  v: number;
  bot: { id: string; name: string; avatar: string | null };
  written_at: number;
  expires_at: number;
  tv: {
    type: 'board'; style: StageBoardStyle; title: string; text: string; accent: number | null; scores: StageScore[];
    buttons: { message_id: string; items: { custom_id: string; label: string; style: number; disabled: boolean }[] } | null;
  } | { type: 'video'; video_id: string; started_at: number; paused_at: number | null } | null;
  host: { character: StageHostCharacter; shirt: number } | null;
}

export type StageEffect =
  | { type: 'confetti' }
  | { type: 'spotlight'; user_id: string }
  | { type: 'host_emote'; emote: 'wave' | 'dance' | 'jump' }
  | { type: 'host_emote'; emote: 'emoji'; emoji: string };

export interface TournamentTable {
  slot?: string;
  x?: number;
  z?: number;
  yaw?: number;
}

export interface TournamentInput {
  game: TournamentGame;
  size: TournamentSize;
  table?: TournamentTable;
}

export interface TournamentMatch {
  a: string;
  b: string | null;
  w: string | null;
}

export interface TournamentCurrentMatch {
  mid: string;
  r: number;
  i: number;
  a: string;
  b: string;
  phase: 'call' | 'fight' | 'paused' | 'result';
  until: number;
  t0?: number;
  te?: number;
  slot?: string;
  present: number[];
}

export interface RoomTournament {
  v: number;
  id: string;
  ver: number;
  game: TournamentGame;
  size: TournamentSize;
  status: 'registration' | 'running' | 'ended' | 'canceled';
  entrants: string[];
  rounds: TournamentMatch[][];
  cur: TournamentCurrentMatch | null;
  champion: string | null;
  t: number;
}

export interface TournamentReadOptions extends MicupRequestOptions {
  connectionId?: string;
}

const forbiddenRanges: readonly (readonly [number, number])[] = [
  [0x00, 0x08], [0x0b, 0x1f], [0x7f, 0x9f], [0x2028, 0x2029], [0x200e, 0x200f], [0x061c, 0x061c],
  [0x202a, 0x202e], [0x2066, 0x2069], [0x200b, 0x200b], [0x2060, 0x2060], [0xfeff, 0xfeff],
];
const hasForbiddenText = (value: string): boolean => [...value].some((char) => {
  const code = char.codePointAt(0)!;
  return forbiddenRanges.some(([low, high]) => code >= low && code <= high);
});
const colour = (value: number, label: string) => {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffffff) throw new RangeError(label + ' must be an RGB integer');
  return value;
};

function plain(value: string | null | undefined, max: number, lines: number, label: string): void {
  if (value === undefined || value === null) return;
  if (typeof value !== 'string' || [...value].length > max || value.split('\n').length > lines || hasForbiddenText(value)) {
    throw new RangeError(label + ' takes plain text of up to ' + max + ' characters on up to ' + lines + ' lines');
  }
}

function stageBody({ tv, host, ttl_seconds }: VoiceRoomStageInput): object {
  if (ttl_seconds !== undefined && (!Number.isSafeInteger(ttl_seconds) || ttl_seconds < 60 || ttl_seconds > 21_600)) {
    throw new RangeError('A stage lasts 60 to 21600 seconds');
  }
  if (tv?.type === 'board') {
    if (tv.style !== undefined && !['neon', 'tahta', 'sade'].includes(tv.style)) throw new TypeError('Invalid stage board style');
    plain(tv.title, 60, 1, 'Stage title');
    plain(tv.text, 280, 4, 'Stage text');
    if (tv.accent !== undefined) colour(tv.accent, 'Stage accent');
    if ((tv.scores?.length ?? 0) > 10) throw new RangeError('A stage board takes up to 10 scores');
    for (const score of tv.scores ?? []) {
      plain(score.name, 32, 1, 'Score name');
      if (!score.name || !Number.isSafeInteger(score.value) || Math.abs(score.value) > 1_000_000_000) throw new RangeError('Invalid stage score');
      if (score.user_id) snowflake(score.user_id, 'Score user ID');
    }
    if (tv.message_id !== undefined) snowflake(tv.message_id, 'Message ID');
  } else if (tv?.type === 'video') {
    if (typeof tv.url !== 'string' || !tv.url || tv.url.length > 2048) throw new TypeError('A stage video needs a URL of up to 2048 characters');
    if (tv.paused !== undefined && typeof tv.paused !== 'boolean') throw new TypeError('A stage video pause state must be a boolean');
    if (tv.position_ms !== undefined && (!Number.isSafeInteger(tv.position_ms) || tv.position_ms < 0 || tv.position_ms > 86_400_000)) {
      throw new RangeError('A stage video position takes 0 to 86400000 milliseconds');
    }
  } else if (tv) {
    throw new TypeError('A stage TV shows a board or a video');
  }
  if (host?.character !== undefined && !['ithp-gunluk', 'ithp-ceketli', 'ithp-gozluk', 'ithp-kulaklik', 'ithp-rahat', 'ithp-sapkali', 'ithp-sehirli', 'ithp-yazlik'].includes(host.character)) {
    throw new TypeError('Invalid host character');
  }
  if (host?.shirt !== undefined) colour(host.shirt, 'Host shirt');
  return { tv: tv ?? null, host: host ?? null, ...(ttl_seconds !== undefined && { ttl_seconds }) };
}

function effectBody(effect: StageEffect): object {
  if (effect.type === 'spotlight') snowflake(effect.user_id, 'User ID');
  else if (effect.type === 'host_emote') {
    if (!['wave', 'dance', 'jump', 'emoji'].includes(effect.emote)) throw new TypeError('Invalid host emote');
    if (effect.emote === 'emoji' && !('emoji' in effect && typeof effect.emoji === 'string' && effect.emoji && [...effect.emoji].length <= 16)) {
      throw new TypeError('An emoji emote needs one emoji');
    }
  } else if (effect.type !== 'confetti') {
    throw new TypeError('Invalid stage effect');
  }
  return effect;
}

function tournamentBody({ game, size, table }: TournamentInput): object {
  if (game !== 'slap' && game !== 'arm_wrestle') throw new TypeError('A room tournament is slap or arm_wrestle');
  if (![4, 8, 16, 32].includes(size)) throw new RangeError('A room tournament takes 4, 8, 16 or 32 entrants');
  if (table) {
    const point = table.x !== undefined || table.z !== undefined || table.yaw !== undefined;
    if (table.slot !== undefined === point) throw new TypeError('A tournament table is a slot or a floor point');
    if (table.slot !== undefined && (typeof table.slot !== 'string' || !table.slot)) throw new TypeError('A tournament table slot must be a nonempty string');
    if (point && (![table.x, table.z].every((value) => Number.isFinite(value) && Math.abs(value!) <= 100) ||
        !Number.isFinite(table.yaw) || Math.abs(table.yaw!) > Math.PI)) {
      throw new RangeError('A floor point takes x and z within 100 metres and a yaw within pi');
    }
  }
  return { game, size, ...(table && { table: table.slot !== undefined ? { slot: table.slot } : table }) };
}

function roomPath(channelId: string): string {
  return '/channels/' + snowflake(channelId, 'Channel ID') + '/voice-room';
}

export class MicupVoiceRooms {
  constructor(private readonly rest: RestTransport) {}

  async stage(channelId: string, options?: MicupRequestOptions): Promise<VoiceRoomStage | null> {
    const { stage } = await this.rest.request<{ stage: VoiceRoomStage | null }>('GET', roomPath(channelId) + '/stage', options);
    return stage;
  }

  setStage(channelId: string, stage: VoiceRoomStageInput, options?: MicupRequestOptions): Promise<VoiceRoomStage> {
    return this.rest.request('PUT', roomPath(channelId) + '/stage', { ...options, body: stageBody(stage) });
  }

  clearStage(channelId: string, options?: MicupRequestOptions): Promise<void> {
    return this.rest.request('DELETE', roomPath(channelId) + '/stage', options);
  }

  stageEffect(channelId: string, effect: StageEffect, options?: MicupRequestOptions): Promise<void> {
    return this.rest.request('POST', roomPath(channelId) + '/stage/effects', { ...options, body: effectBody(effect) });
  }

  async tournament(channelId: string, { connectionId, signal }: TournamentReadOptions = {}): Promise<RoomTournament | null> {
    const query = connectionId === undefined ? undefined : new URLSearchParams({ connection_id: connectionId });
    const { tournament } = await this.rest.request<{ tournament: RoomTournament | null }>('GET', roomPath(channelId) + '/tournament', { query, signal });
    return tournament;
  }

  openTournament(channelId: string, input: TournamentInput, options?: MicupRequestOptions): Promise<RoomTournament> {
    return this.rest.request('POST', roomPath(channelId) + '/tournament', { ...options, body: tournamentBody(input) });
  }

  cancelTournament(channelId: string, options?: MicupRequestOptions): Promise<void> {
    return this.rest.request('DELETE', roomPath(channelId) + '/tournament', options);
  }

  reorderTournament(channelId: string, version: number, userIds: readonly string[], options?: MicupRequestOptions): Promise<RoomTournament> {
    if (!Number.isSafeInteger(version) || version < 0 || !Array.isArray(userIds) || userIds.length < 2 || userIds.length > 32 || new Set(userIds).size !== userIds.length) {
      throw new RangeError('A tournament order lists 2 to 32 distinct entrants for one version');
    }
    return this.rest.request('PUT', roomPath(channelId) + '/tournament/order', {
      ...options, body: { version, user_ids: userIds.map((id) => snowflake(id, 'User ID')) },
    });
  }

  startTournament(channelId: string, version: number, options?: MicupRequestOptions): Promise<RoomTournament> {
    if (!Number.isSafeInteger(version) || version < 0) throw new TypeError('A tournament start needs a nonnegative tournament version');
    return this.rest.request('POST', roomPath(channelId) + '/tournament/start', { ...options, body: { version } });
  }
}
