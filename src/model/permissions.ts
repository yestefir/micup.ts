import type { MicupRole, PermissionOverwrite } from './guild.js';

export const Permission = {
  CreateInstantInvite: 1n << 0n,
  KickMembers: 1n << 1n,
  BanMembers: 1n << 2n,
  Administrator: 1n << 3n,
  ManageChannels: 1n << 4n,
  ManageGuild: 1n << 5n,
  AddReactions: 1n << 6n,
  ViewAuditLog: 1n << 7n,
  PrioritySpeaker: 1n << 8n,
  Stream: 1n << 9n,
  ViewChannel: 1n << 10n,
  SendMessages: 1n << 11n,
  SendTTSMessages: 1n << 12n,
  ManageMessages: 1n << 13n,
  EmbedLinks: 1n << 14n,
  AttachFiles: 1n << 15n,
  ReadMessageHistory: 1n << 16n,
  MentionEveryone: 1n << 17n,
  UseExternalEmojis: 1n << 18n,
  Connect: 1n << 20n,
  Speak: 1n << 21n,
  MuteMembers: 1n << 22n,
  DeafenMembers: 1n << 23n,
  MoveMembers: 1n << 24n,
  UseVAD: 1n << 25n,
  ChangeNickname: 1n << 26n,
  ManageNicknames: 1n << 27n,
  ManageRoles: 1n << 28n,
  ManageWebhooks: 1n << 29n,
  ManageExpressions: 1n << 30n,
  ManageThreads: 1n << 34n,
  CreatePublicThreads: 1n << 35n,
  CreatePrivateThreads: 1n << 36n,
  UseExternalStickers: 1n << 37n,
  SendMessagesInThreads: 1n << 38n,
  ModerateMembers: 1n << 40n,
  CreateExpressions: 1n << 43n,
  PinMessages: 1n << 51n,
  BypassSlowmode: 1n << 52n,
  UpdateRTCRegion: 1n << 53n,
  ViewChannelMembers: 1n << 54n,
  ManageRoomStage: 1n << 62n,
  All: (1n << 63n) - 1n,
} as const;

function bits(value?: string | number): bigint {
  if (typeof value === 'string' && /^\d{1,20}$/.test(value)) return BigInt(value);
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return BigInt(value);
  return 0n;
}

export function hasPermissions(permissions: bigint, required: bigint): boolean {
  return (permissions & required) === required;
}

const permissionNameList: readonly (readonly [string, bigint])[] = [
  ['CREATE_INSTANT_INVITE', Permission.CreateInstantInvite], ['KICK_MEMBERS', Permission.KickMembers], ['BAN_MEMBERS', Permission.BanMembers],
  ['ADMINISTRATOR', Permission.Administrator], ['MANAGE_CHANNELS', Permission.ManageChannels], ['MANAGE_GUILD', Permission.ManageGuild],
  ['ADD_REACTIONS', Permission.AddReactions], ['VIEW_AUDIT_LOG', Permission.ViewAuditLog], ['PRIORITY_SPEAKER', Permission.PrioritySpeaker],
  ['STREAM', Permission.Stream], ['VIEW_CHANNEL', Permission.ViewChannel], ['SEND_MESSAGES', Permission.SendMessages],
  ['SEND_TTS_MESSAGES', Permission.SendTTSMessages], ['MANAGE_MESSAGES', Permission.ManageMessages], ['EMBED_LINKS', Permission.EmbedLinks],
  ['ATTACH_FILES', Permission.AttachFiles], ['READ_MESSAGE_HISTORY', Permission.ReadMessageHistory], ['MENTION_EVERYONE', Permission.MentionEveryone],
  ['USE_EXTERNAL_EMOJIS', Permission.UseExternalEmojis], ['CONNECT', Permission.Connect], ['SPEAK', Permission.Speak],
  ['MUTE_MEMBERS', Permission.MuteMembers], ['DEAFEN_MEMBERS', Permission.DeafenMembers], ['MOVE_MEMBERS', Permission.MoveMembers],
  ['USE_VAD', Permission.UseVAD], ['CHANGE_NICKNAME', Permission.ChangeNickname], ['MANAGE_NICKNAMES', Permission.ManageNicknames],
  ['MANAGE_ROLES', Permission.ManageRoles], ['MANAGE_WEBHOOKS', Permission.ManageWebhooks], ['MANAGE_EXPRESSIONS', Permission.ManageExpressions],
  ['MANAGE_THREADS', Permission.ManageThreads], ['CREATE_PUBLIC_THREADS', Permission.CreatePublicThreads],
  ['CREATE_PRIVATE_THREADS', Permission.CreatePrivateThreads], ['USE_EXTERNAL_STICKERS', Permission.UseExternalStickers],
  ['SEND_MESSAGES_IN_THREADS', Permission.SendMessagesInThreads], ['MODERATE_MEMBERS', Permission.ModerateMembers],
  ['CREATE_EXPRESSIONS', Permission.CreateExpressions], ['PIN_MESSAGES', Permission.PinMessages], ['BYPASS_SLOWMODE', Permission.BypassSlowmode],
  ['UPDATE_RTC_REGION', Permission.UpdateRTCRegion], ['VIEW_CHANNEL_MEMBERS', Permission.ViewChannelMembers],
  ['MANAGE_ROOM_STAGE', Permission.ManageRoomStage],
];

export const ElevatedPermissions: bigint =
  Permission.KickMembers | Permission.BanMembers | Permission.Administrator | Permission.ManageChannels | Permission.ManageGuild |
  Permission.ManageMessages | Permission.ManageRoles | Permission.ManageWebhooks | Permission.ModerateMembers | Permission.ManageThreads;

export function permissionNames(permissions: bigint): string[] {
  return permissionNameList.filter(([, bit]) => (permissions & bit) === bit).map(([name]) => name);
}

export function parsePermission(name: string): bigint | undefined {
  const wanted = name.trim().toUpperCase();
  return permissionNameList.find(([known]) => known === wanted)?.[1];
}

export function missingPermissions(have: bigint, required: bigint): bigint {
  return (have & Permission.Administrator) === Permission.Administrator ? 0n : required & ~have;
}

export function computePermissions(
  guildId: string,
  ownerId: string | undefined,
  userId: string,
  roles: ReadonlyMap<string, MicupRole>,
  memberRoles: readonly string[],
  overwrites: readonly PermissionOverwrite[] = [],
): bigint {
  if (userId && userId === ownerId) return Permission.All;
  let permissions = bits(roles.get(guildId)?.permissions);
  for (const id of memberRoles) permissions |= bits(roles.get(id)?.permissions);
  if (hasPermissions(permissions, Permission.Administrator)) return Permission.All;

  const byId = new Map(overwrites.map((entry) => [entry.id, entry]));
  const everyone = byId.get(guildId);
  if (everyone) permissions = (permissions & ~bits(everyone.deny)) | bits(everyone.allow);
  let allow = 0n;
  let deny = 0n;
  for (const id of memberRoles) {
    const entry = byId.get(id);
    if (entry?.type === 0) {
      allow |= bits(entry.allow);
      deny |= bits(entry.deny);
    }
  }
  permissions = (permissions & ~deny) | allow;
  const user = byId.get(userId);
  if (user?.type === 1) permissions = (permissions & ~bits(user.deny)) | bits(user.allow);
  return permissions;
}
