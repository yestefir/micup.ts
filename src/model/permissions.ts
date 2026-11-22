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
