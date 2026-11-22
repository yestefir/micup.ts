export const AuditAction = {
  GuildUpdate: 1,
  ChannelCreate: 10,
  ChannelUpdate: 11,
  ChannelDelete: 12,
  ChannelOverwriteCreate: 13,
  ChannelOverwriteUpdate: 14,
  ChannelOverwriteDelete: 15,
  MemberKick: 20,
  MemberPrune: 21,
  MemberBanAdd: 22,
  MemberBanRemove: 23,
  MemberUpdate: 24,
  MemberRoleUpdate: 25,
  MemberMove: 26,
  MemberDisconnect: 27,
  BotAdd: 28,
  RoleCreate: 30,
  RoleUpdate: 31,
  RoleDelete: 32,
  InviteCreate: 40,
  InviteUpdate: 41,
  InviteDelete: 42,
  WebhookCreate: 50,
  WebhookUpdate: 51,
  WebhookDelete: 52,
  EmojiCreate: 60,
  EmojiUpdate: 61,
  EmojiDelete: 62,
  MessageDelete: 72,
  MessageBulkDelete: 73,
  MessagePin: 74,
  MessageUnpin: 75,
  StickerCreate: 90,
  StickerUpdate: 91,
  StickerDelete: 92,
  ThreadCreate: 110,
  ThreadUpdate: 111,
  ThreadDelete: 112,
} as const;

export const ChannelType = {
  GuildText: 0,
  DM: 1,
  GuildVoice: 2,
  GroupDM: 3,
  GuildCategory: 4,
  GuildAnnouncement: 5,
  AnnouncementThread: 10,
  PublicThread: 11,
  PrivateThread: 12,
  GuildForum: 15,
  GuildMedia: 16,
  GuildLink: 998,
  PersonalNotes: 999,
} as const;

export const ChannelFlag = {
  Pinned: 1 << 1,
  RequireTag: 1 << 4,
  HideMediaDownloadOptions: 1 << 15,
} as const;

export const AutoArchiveDuration = {
  Hour: 60,
  Day: 1440,
  ThreeDays: 4320,
  Week: 10080,
} as const;

export const ForumSortOrder = {
  LatestActivity: 0,
  CreationTime: 1,
} as const;

export const ForumLayout = {
  Default: 0,
  List: 1,
  Grid: 2,
} as const;

export const ForumTagMatch = {
  Some: 'match_some',
  All: 'match_all',
} as const;

export const ThreadMemberFlag = {
  HasInteracted: 1 << 0,
  AllMessages: 1 << 1,
  OnlyMentions: 1 << 2,
  NoMessages: 1 << 3,
} as const;

export const VerificationLevel = {
  None: 0,
  Low: 1,
  Medium: 2,
  High: 3,
} as const;

export const MfaLevel = {
  None: 0,
  Elevated: 1,
} as const;

export const ExplicitContentFilter = {
  Disabled: 0,
  MembersWithoutRoles: 1,
  AllMembers: 2,
} as const;

export const DefaultMessageNotifications = {
  AllMessages: 0,
  OnlyMentions: 1,
} as const;

export const SystemChannelFlag = {
  SuppressJoinNotifications: 1 << 0,
} as const;

export const GuildFeature = {
  AnimatedBanner: 'ANIMATED_BANNER',
  AnimatedIcon: 'ANIMATED_ICON',
  Banner: 'BANNER',
  CloneEmojiEnabled: 'CLONE_EMOJI_ENABLED',
  CloneStickerEnabled: 'CLONE_STICKER_ENABLED',
  DetachedBanner: 'DETACHED_BANNER',
  Discoverable: 'DISCOVERABLE',
  ExpressionPurgeAllowed: 'EXPRESSION_PURGE_ALLOWED',
  HideOwnerCrown: 'HIDE_OWNER_CROWN',
  InviteSplash: 'INVITE_SPLASH',
  InvitesDisabled: 'INVITES_DISABLED',
  Partnered: 'PARTNERED',
  TextChannelFlexibleNames: 'TEXT_CHANNEL_FLEXIBLE_NAMES',
  VanityURL: 'VANITY_URL',
  Verified: 'VERIFIED',
  VisitsEnabled: 'VISITS_ENABLED',
  VoiceE2EE: 'VOICE_E2EE',
} as const;

export const InviteType = {
  Guild: 0,
  GroupDM: 1,
} as const;

export const MessageType = {
  Default: 0,
  RecipientAdd: 1,
  RecipientRemove: 2,
  Call: 3,
  ChannelNameChange: 4,
  ChannelIconChange: 5,
  ChannelPinnedMessage: 6,
  UserJoin: 7,
  ChannelFollowAdd: 12,
  ThreadCreated: 18,
  Reply: 19,
  ThreadStarterMessage: 21,
} as const;

export const AttachmentFlag = {
  Spoiler: 1 << 3,
  ExplicitMedia: 1 << 4,
  Animated: 1 << 5,
} as const;

export const MessageReferenceType = {
  Default: 0,
  Forward: 1,
} as const;

export const AllowedMentionType = {
  Users: 'users',
  Roles: 'roles',
  Everyone: 'everyone',
} as const;

export const SearchAuthorType = {
  User: 'user',
  Bot: 'bot',
  Webhook: 'webhook',
} as const;

export const SearchHas = {
  Image: 'image',
  Sound: 'sound',
  Video: 'video',
  File: 'file',
  Sticker: 'sticker',
  Embed: 'embed',
  Link: 'link',
  Snapshot: 'snapshot',
} as const;

export const SearchSort = {
  Timestamp: 'timestamp',
  Relevance: 'relevance',
} as const;

export const SortOrder = {
  Ascending: 'asc',
  Descending: 'desc',
} as const;

export const EmbedType = {
  Rich: 'rich',
} as const;

export const ImageFormat = {
  PNG: 'png',
  JPEG: 'jpg',
  WebP: 'webp',
  GIF: 'gif',
  AVIF: 'avif',
} as const;

export const MemberProfileFlag = {
  AvatarUnset: 1 << 0,
  BannerUnset: 1 << 1,
} as const;

export const MentionPreference = {
  NoPreference: 0,
  PreferMention: 1,
  PreferNoMention: 2,
} as const;

export const JoinSource = {
  Creator: 0,
  InstantInvite: 1,
  VanityURL: 2,
  BotInvite: 3,
  AdminForceAdd: 4,
  Discovery: 6,
} as const;

export const UserFlag = {
  Staff: 1 << 0,
  Partner: 1 << 2,
  BugHunter: 1 << 3,
  FriendlyBot: 1 << 4,
  FriendlyBotManualApproval: 1 << 5,
  Spammer: 1 << 6,
  ProfileHidden: 1 << 7,
} as const;

export const WebhookType = {
  Incoming: 1,
  ChannelFollower: 2,
} as const;

export const SelectDefaultType = {
  User: 'user',
  Role: 'role',
  Channel: 'channel',
} as const;

export const InteractionContextType = {
  Guild: 0,
  BotDM: 1,
  PrivateChannel: 2,
} as const;

export const Status = {
  Online: 'online',
  Idle: 'idle',
  DND: 'dnd',
  Invisible: 'invisible',
  Offline: 'offline',
} as const;

export const RelationshipType = {
  Friend: 1,
  Blocked: 2,
  IncomingRequest: 3,
  OutgoingRequest: 4,
} as const;

export const GatewayFlag = {
  DebounceMessageReactions: 1 << 1,
  ChannelThreads: 1 << 2,
  GuildVisits: 1 << 3,
} as const;

export const GatewayCloseCode = {
  UnknownError: 4000,
  UnknownOpcode: 4001,
  DecodeError: 4002,
  NotAuthenticated: 4003,
  AuthenticationFailed: 4004,
  AlreadyAuthenticated: 4005,
  InvalidSequence: 4007,
  RateLimited: 4008,
  SessionTimeout: 4009,
  InvalidShard: 4010,
  ShardingRequired: 4011,
  InvalidAPIVersion: 4012,
} as const;

export const VoiceRefusalCode = {
  ChannelFull: 'VOICE_CHANNEL_FULL',
  P2PConsentRequired: 'VOICE_P2P_CONSENT_REQUIRED',
  P2PUnavailable: 'VOICE_P2P_UNAVAILABLE',
} as const;

export const OverwriteType = {
  Role: 0,
  Member: 1,
} as const;

export const Limits = {
  GuildsPerShard: 2500,
  AuditLogEntries: 100,
  ChannelName: 100,
  ChannelTopic: 1024,
  ForumTopic: 4096,
  SlowmodeSeconds: 21600,
  ForumTags: 20,
  AppliedTags: 5,
  ForumTagName: 50,
  ChannelPositions: 500,
  CommandOptions: 25,
  CommandChoices: 25,
  CommandName: 32,
  CommandDescription: 100,
  ActionRows: 5,
  ButtonsPerRow: 5,
  CustomIDLength: 100,
  ButtonLabelLength: 80,
  EmbedTitle: 256,
  EmbedDescription: 4096,
  EmbedFields: 25,
  EmbedFieldName: 256,
  EmbedFieldValue: 1024,
  EmbedFooter: 2048,
  EmbedAuthor: 256,
  EmbedURL: 2048,
  InviteUses: 100,
  InviteAge: 604800,
  BulkExpressions: 50,
  EmojiName: 32,
  StickerName: 30,
  Embeds: 10,
  Attachments: 10,
  BulkDelete: 100,
  MessagesPerPage: 100,
  StickersPerMessage: 3,
  ReactionUsersPerPage: 100,
  PinsPerPage: 50,
  RefreshURLs: 50,
  SearchHitsPerPage: 25,
  SearchPage: 400,
  ModalInputs: 5,
  ModalTitle: 45,
  TextInputLabel: 45,
  TextInputLength: 4000,
  TextInputPrompts: 100,
  CustomStatusText: 128,
  CustomStatusEmoji: 32,
  RoleName: 100,
  RoleColor: 0xFFFFFF,
  SelectOptions: 25,
  SelectPlaceholder: 150,
  SelectOptionLabel: 100,
  SelectOptionValue: 100,
  SelectOptionDescription: 100,
  WebhookName: 80,
} as const;
