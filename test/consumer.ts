import { GatewaySession, MicupClient, knownGatewayEvents, type GatewaySubscription, type MessageForward } from 'micup.ts';
import { Player, VoiceRoom, type VoiceTrack } from '@micup.ts/voice';

export const exportsForTypeCheck = { GatewaySession, MicupClient, Player, VoiceRoom, knownGatewayEvents };
export const subscription: GatewaySubscription = { active: true };
export const reference: MessageForward = { channel_id: '1', message_id: '2' };

export async function openAudioTrack(room: VoiceRoom): Promise<VoiceTrack> {
  return room.openTrack();
}

import { InteractionRouter as ConsumerRouter, EventMux as ConsumerMux, MicupClient as ConsumerClient } from 'micup.ts';
import { VoiceConnection as ConsumerVoice } from '@micup.ts/voice';

export async function typedWiring(client: ConsumerClient): Promise<void> {
  const router = new ConsumerRouter();
  const events = new ConsumerMux();
  events.on('INTERACTION_CREATE', (interaction, _event, signal) => router.handle(interaction, signal));
  const session = client.newSession({ handler: events.handle });
  const connection = await ConsumerVoice.connect(session, '1', '2');
  await connection.disconnect();
}

import {
  Client as EasyClient, SlashCommand as EasySlashCommand, Permission as EasyPermission, primaryButton as easyButton, actionRow as easyRow,
  type CommandInteraction as EasyCommandInteraction, type Message as EasyMessage,
} from 'micup.ts/easy';

export async function easyUsage(): Promise<void> {
  const client = new EasyClient({ token: 'x', shards: 'auto', registerCommands: { guildId: '1' }, errorReply: (error) => String(error) });
  client.on('ready', (ready) => void ready.user?.id);
  client.on('messageCreate', async (message: EasyMessage) => {
    if (message.author.bot) return;
    const sent = await message.reply({ content: 'pong', components: [easyRow(easyButton('a', 'A'))] });
    await sent.react('👍');
  });
  client.on('GUILD_BAN_ADD', (data) => void data.guild_id);
  client.on('guildMemberAdd', (member) => void member.hasPermission(EasyPermission.SendMessages));
  client.command(new EasySlashCommand('tool', 'Tools').addSubcommand('echo', 'Echo', (sub) => sub.addString('text', 'Text', { required: true })), async (interaction: EasyCommandInteraction) => {
    const text: string = interaction.options.getString('text', true);
    const optional: number | null = interaction.options.getInteger('n');
    await interaction.reply({ content: text + String(optional), ephemeral: true });
  });
  client.component('vote:*', (interaction) => interaction.update({ content: interaction.customId, components: [] }));
  client.modal(/^form/, (interaction) => void interaction.fields.getTextInputValue('a', true).length);
  client.autocomplete('tool echo', (interaction) => interaction.respond(['a', { name: 'B', value: 'b' }]));
  const result = await client.registerCommands({ prune: false });
  void result.created.length;
  await client.login();
  await client.setCustomStatus('hello');
  await client.destroy();
}
