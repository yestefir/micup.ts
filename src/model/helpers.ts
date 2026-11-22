import { MessageFlag, type MicupMessage, type MicupUser } from './entities.js';
import type { Emoji } from './format.js';
import type { ActionRow, Button, SelectMenu, SelectOption, TextInput } from './components.js';
import { ButtonStyle, ComponentType, TextInputStyle, actionRow } from './components.js';
import { ChannelType, MessageReferenceType, MessageType } from './constants.js';
import type { MicupChannel, MicupGuild, MicupMember, MicupRole } from './guild.js';
import type { CommandData, CommandOptionValue, ComponentData, MicupInteraction, ModalData } from './interaction.js';
import { CommandOptionType, InteractionType } from './interaction.js';
import { snowflakeTime } from './format.js';

export function primaryButton(customId: string, label: string): Button {
  return { type: 2, style: ButtonStyle.Primary, custom_id: customId, label };
}

export function secondaryButton(customId: string, label: string): Button {
  return { type: 2, style: ButtonStyle.Secondary, custom_id: customId, label };
}

export function successButton(customId: string, label: string): Button {
  return { type: 2, style: ButtonStyle.Success, custom_id: customId, label };
}

export function dangerButton(customId: string, label: string): Button {
  return { type: 2, style: ButtonStyle.Danger, custom_id: customId, label };
}

export function linkButton(url: string, label: string): Button {
  return { type: 2, style: ButtonStyle.Link, url, label };
}

export function buttonWithEmoji(button: Button, emoji: Emoji): Button {
  return { ...button, emoji };
}

export function selectOption(label: string, value: string, extra: Partial<Omit<SelectOption, 'label' | 'value'>> = {}): SelectOption {
  return { label, value, ...extra };
}

export function stringSelect(customId: string, ...options: SelectOption[]): SelectMenu {
  return { type: ComponentType.StringSelect, custom_id: customId, options };
}

export function userSelect(customId: string): SelectMenu {
  return { type: ComponentType.UserSelect, custom_id: customId };
}

export function roleSelect(customId: string): SelectMenu {
  return { type: ComponentType.RoleSelect, custom_id: customId };
}

export function mentionableSelect(customId: string): SelectMenu {
  return { type: ComponentType.MentionableSelect, custom_id: customId };
}

export function channelSelect(customId: string, ...channelTypes: number[]): SelectMenu {
  return { type: ComponentType.ChannelSelect, custom_id: customId, ...(channelTypes.length && { channel_types: channelTypes }) };
}

export const defaultUser = (id: string) => ({ id, type: 'user' as const });
export const defaultRole = (id: string) => ({ id, type: 'role' as const });
export const defaultChannel = (id: string) => ({ id, type: 'channel' as const });

export function isSelectType(componentType: number): boolean {
  return [ComponentType.StringSelect, ComponentType.UserSelect, ComponentType.RoleSelect, ComponentType.MentionableSelect, ComponentType.ChannelSelect]
    .some((type) => type === componentType);
}

export function shortInput(customId: string, label: string): TextInput {
  return { type: 4, style: TextInputStyle.Short, custom_id: customId, label };
}

export function paragraphInput(customId: string, label: string): TextInput {
  return { type: 4, style: TextInputStyle.Paragraph, custom_id: customId, label };
}

export function disableButtons(rows: readonly ActionRow[]): ActionRow[] {
  return rows.map((row) => ({
    ...row,
    components: row.components.map((original) => {
      const component = structuredClone(original);
      if (component.type === 2 && component.style !== ButtonStyle.Link) component.disabled = true;
      return component;
    }) as unknown as ActionRow['components'],
  }));
}

export function buttonRow(...buttons: Button[]): ActionRow {
  return actionRow(...buttons);
}

export function imageData(contentType: string, data: Uint8Array): string {
  if (!contentType || !data?.byteLength) throw new TypeError('Image data needs a content type and bytes');
  return 'data:' + contentType + ';base64,' + Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString('base64');
}

export const isCommandInteraction = (interaction: MicupInteraction): boolean => interaction.type === InteractionType.Command;
export const isAutocompleteInteraction = (interaction: MicupInteraction): boolean => interaction.type === InteractionType.Autocomplete;
export const isModalSubmitInteraction = (interaction: MicupInteraction): boolean => interaction.type === InteractionType.Modal;
export const isButtonInteraction = (interaction: MicupInteraction): boolean =>
  interaction.type === InteractionType.Component && interaction.data.component_type === ComponentType.Button;
export const isSelectInteraction = (interaction: MicupInteraction): boolean =>
  interaction.type === InteractionType.Component && isSelectType(interaction.data.component_type);

export function interactionCustomId(interaction: MicupInteraction): string | undefined {
  return interaction.type === InteractionType.Component || interaction.type === InteractionType.Modal ? interaction.data.custom_id : undefined;
}

export function interactionInvoker(interaction: MicupInteraction): MicupUser | undefined {
  return interaction.member?.user ?? interaction.user;
}

export function leafOptions(data: CommandData): readonly CommandOptionValue[] {
  let options = data.options ?? [];
  for (let depth = 0; depth < 2; depth++) {
    const child = options.find((option) => option.type === CommandOptionType.Subcommand || option.type === CommandOptionType.SubcommandGroup);
    if (!child) break;
    options = child.options ?? [];
  }
  return options;
}

export function commandOption(data: CommandData, name: string): CommandOptionValue | undefined {
  return leafOptions(data).find((option) => option.name === name);
}

export function focusedOption(data: CommandData): CommandOptionValue | undefined {
  return leafOptions(data).find((option) => option.focused);
}

export function optionString(data: CommandData, name: string): string | undefined {
  const value = commandOption(data, name)?.value;
  return typeof value === 'string' ? value : undefined;
}

export function optionInteger(data: CommandData, name: string): number | undefined {
  const value = commandOption(data, name)?.value;
  return typeof value === 'number' && Number.isInteger(value) ? value : undefined;
}

export function optionNumber(data: CommandData, name: string): number | undefined {
  const value = commandOption(data, name)?.value;
  return typeof value === 'number' ? value : undefined;
}

export function optionBoolean(data: CommandData, name: string): boolean | undefined {
  const value = commandOption(data, name)?.value;
  return typeof value === 'boolean' ? value : undefined;
}

function resolvedMember(resolved: CommandData['resolved'], id: string): MicupMember | undefined {
  const member = resolved?.members?.[id];
  const user = resolved?.users?.[id];
  return member ? { ...member, ...(user && { user }) } : undefined;
}

export function optionUser(data: CommandData, name: string): MicupUser | undefined {
  const id = optionString(data, name);
  return id === undefined ? undefined : data.resolved?.users?.[id];
}

export function optionMember(data: CommandData, name: string): MicupMember | undefined {
  const id = optionString(data, name);
  return id === undefined ? undefined : resolvedMember(data.resolved, id);
}

export function optionRole(data: CommandData, name: string): MicupRole | undefined {
  const id = optionString(data, name);
  return id === undefined ? undefined : data.resolved?.roles?.[id];
}

export function optionChannel(data: CommandData, name: string): MicupChannel | undefined {
  const id = optionString(data, name);
  return id === undefined ? undefined : data.resolved?.channels?.[id];
}

export function optionAttachment(data: CommandData, name: string): { id: string; filename: string; url: string } | undefined {
  const id = optionString(data, name);
  return id === undefined ? undefined : data.resolved?.attachments?.[id];
}

export function targetUser(data: CommandData): MicupUser | undefined {
  return data.target_id === undefined ? undefined : data.resolved?.users?.[data.target_id];
}

export function targetMessage(data: CommandData): MicupMessage | undefined {
  return data.target_id === undefined ? undefined : data.resolved?.messages?.[data.target_id];
}

export function modalValue(data: ModalData, customId: string): string | undefined {
  for (const row of data.components) {
    for (const input of row.components ?? []) if (input.custom_id === customId) return input.value;
  }
  return undefined;
}

export function selectedUsers(data: ComponentData): MicupUser[] {
  return (data.values ?? []).flatMap((id) => data.resolved?.users?.[id] ?? []);
}

export function selectedMembers(data: ComponentData): MicupMember[] {
  return (data.values ?? []).flatMap((id) => resolvedMember(data.resolved, id) ?? []);
}

export function selectedRoles(data: ComponentData): MicupRole[] {
  return (data.values ?? []).flatMap((id) => data.resolved?.roles?.[id] ?? []);
}

export function selectedChannels(data: ComponentData): MicupChannel[] {
  return (data.values ?? []).flatMap((id) => data.resolved?.channels?.[id] ?? []);
}

export const isDMChannel = (channel: Pick<MicupChannel, 'type'>): boolean => channel.type === ChannelType.DM || channel.type === ChannelType.GroupDM;
export const isVoiceChannel = (channel: Pick<MicupChannel, 'type'>): boolean => channel.type === ChannelType.GuildVoice;
export const isThreadChannel = (channel: Pick<MicupChannel, 'type'>): boolean =>
  [ChannelType.AnnouncementThread, ChannelType.PublicThread, ChannelType.PrivateThread].some((type) => type === channel.type);
export const isForumChannel = (channel: Pick<MicupChannel, 'type'>): boolean =>
  channel.type === ChannelType.GuildForum || channel.type === ChannelType.GuildMedia;

export const isReply = (message: Pick<MicupMessage, 'type'>): boolean => message.type === MessageType.Reply;
export const isForward = (message: { message_reference?: { type?: number } }): boolean => message.message_reference?.type === MessageReferenceType.Forward;
export const isWebhookMessage = (message: { webhook_id?: string }): boolean => Boolean(message.webhook_id);
export const hasMessageFlag = (message: Pick<MicupMessage, 'flags'>, flag: number): boolean => ((message.flags ?? 0) & flag) === flag;
export const isSpoilerAttachment = (attachment: { flags?: number }): boolean => ((attachment.flags ?? 0) & 8) !== 0;
export const messageCreatedAt = (message: Pick<MicupMessage, 'id'>): Date => snowflakeTime(message.id);
export const isEphemeralMessage = (message: Pick<MicupMessage, 'flags'>): boolean => hasMessageFlag(message, MessageFlag.Ephemeral);

export function memberTimedOut(member: { communication_disabled_until?: string | null }, now = new Date()): boolean {
  const until = member.communication_disabled_until;
  return Boolean(until) && new Date(until as string).getTime() > now.getTime();
}

export function guildHasFeature(guild: Pick<MicupGuild, 'features'>, feature: string): boolean {
  return guild.features?.includes(feature) ?? false;
}
