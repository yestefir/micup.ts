import type { MicupMessage, MicupUser } from './entities.js';
import type { MicupChannel, MicupMember, MicupRole } from './guild.js';

export const InteractionType = { Ping: 1, Command: 2, Component: 3, Autocomplete: 4, Modal: 5 } as const;
export const CommandType = { ChatInput: 1, User: 2, Message: 3 } as const;
export const CommandOptionType = {
  Subcommand: 1, SubcommandGroup: 2, String: 3, Integer: 4, Boolean: 5, User: 6,
  Channel: 7, Role: 8, Mentionable: 9, Number: 10, Attachment: 11,
} as const;

type Localizations = Readonly<Record<string, string>>;

export interface CommandChoice {
  name: string;
  value: string | number;
  name_localizations?: Localizations;
}

export interface CommandOption {
  type: number;
  name: string;
  description: string;
  name_localizations?: Localizations;
  description_localizations?: Localizations;
  required?: boolean;
  choices?: readonly CommandChoice[];
  options?: readonly CommandOption[];
  autocomplete?: boolean;
  channel_types?: readonly number[];
  min_value?: number;
  max_value?: number;
  min_length?: number;
  max_length?: number;
}

export interface CommandDefinition {
  name: string;
  type?: number;
  description?: string;
  name_localizations?: Localizations;
  description_localizations?: Localizations;
  options?: readonly CommandOption[];
  default_member_permissions?: string | null;
  dm_permission?: boolean;
}

export interface MicupCommand extends CommandDefinition {
  id: string;
  application_id: string;
  guild_id?: string;
  version?: string;
}

export interface CommandOptionValue {
  name: string;
  type: number;
  value?: string | number | boolean;
  focused?: boolean;
  options?: readonly CommandOptionValue[];
}

export interface CommandData {
  id: string;
  name: string;
  type?: number;
  options?: readonly CommandOptionValue[];
  target_id?: string;
  resolved?: {
    users?: Record<string, MicupUser>;
    members?: Record<string, MicupMember>;
    roles?: Record<string, MicupRole>;
    channels?: Record<string, MicupChannel>;
    messages?: Record<string, MicupMessage>;
    attachments?: Record<string, { id: string; filename: string; url: string }>;
  };
}

export interface ComponentData {
  custom_id: string;
  component_type: number;
  values?: string[];
  resolved?: CommandData['resolved'];
}

export interface ModalData {
  custom_id: string;
  components: readonly { type: number; components?: readonly { type: number; custom_id: string; value: string }[] }[];
}

interface InteractionContext {
  id: string;
  application_id: string;
  token: string;
  guild_id?: string;
  channel_id?: string;
  member?: MicupMember;
  user?: MicupUser;
  message?: MicupMessage;
  channel?: MicupChannel;
  locale?: string;
  guild_locale?: string;
  app_permissions?: string;
}

export type MicupInteraction = InteractionContext & (
  | { type: 1; data?: undefined }
  | { type: 2 | 4; data: CommandData }
  | { type: 3; data: ComponentData }
  | { type: 5; data: ModalData }
);

export function commandPath(data: CommandData): string[] {
  const path = [data.name];
  let options = data.options;
  for (let depth = 0; depth < 2 && options?.length; depth++) {
    const child = options.find((option) => option.type === 1 || option.type === 2);
    if (!child) break;
    path.push(child.name);
    options = child.options;
  }
  return path;
}
