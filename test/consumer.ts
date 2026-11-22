import { GatewaySession, MicupClient, knownGatewayEvents, type GatewaySubscription, type MessageForward } from 'micup.ts';
import { Player, VoiceRoom, type VoiceTrack } from '@micupts/voice';

export const exportsForTypeCheck = { GatewaySession, MicupClient, Player, VoiceRoom, knownGatewayEvents };
export const subscription: GatewaySubscription = { active: true };
export const reference: MessageForward = { channel_id: '1', message_id: '2' };

export async function openAudioTrack(room: VoiceRoom): Promise<VoiceTrack> {
  return room.openTrack();
}
