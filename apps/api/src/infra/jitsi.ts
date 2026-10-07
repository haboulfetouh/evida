import jwt from 'jsonwebtoken';
import { env } from '../config';

export interface JitsiTokenInput {
  roomName: string;
  user: { id: string; name: string; email?: string };
  moderator: boolean;
  recording: boolean;
  transcription: boolean;
}

/**
 * Short-lived, room-scoped Jitsi JWT (prosody token auth). Participants receive the minimum
 * permissions needed: only the lead interviewer is moderator, and recording/transcription
 * features are enabled only when org policy, interview setting and candidate consent all allow.
 */
export function jitsiToken(i: JitsiTokenInput): string {
  const e = env();
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign(
    {
      aud: 'jitsi',
      iss: e.JITSI_APP_ID,
      sub: e.JITSI_DOMAIN.split(':')[0],
      room: i.roomName,
      nbf: now - 10,
      exp: now + e.JITSI_TOKEN_TTL,
      context: {
        user: { id: i.user.id, name: i.user.name, email: i.user.email, moderator: i.moderator },
        features: { recording: i.recording, livestreaming: false, transcription: i.transcription, 'outbound-call': false },
      },
    },
    e.JITSI_APP_SECRET,
    { algorithm: 'HS256' },
  );
}

export const jitsiConfig = () => ({ domain: env().JITSI_DOMAIN });
