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
