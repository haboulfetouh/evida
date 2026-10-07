import type { ConsentType } from '../db';

export interface ConsentRow {
  type: ConsentType;
  granted: boolean;
  withdrawnAt: Date | null;
  grantedAt: Date;
}

/** Latest decision per consent type wins; a withdrawal revokes it. */
export function consentState(rows: ConsentRow[]): Record<ConsentType, 'GRANTED' | 'DECLINED' | 'WITHDRAWN' | 'PENDING'> {
  const types: ConsentType[] = ['RECORDING', 'TRANSCRIPTION', 'AI_ANALYSIS', 'PROFILING'];
  const out = {} as Record<ConsentType, 'GRANTED' | 'DECLINED' | 'WITHDRAWN' | 'PENDING'>;
  for (const t of types) {
    const latest = rows.filter((r) => r.type === t).sort((a, b) => b.grantedAt.getTime() - a.grantedAt.getTime())[0];
    out[t] = !latest ? 'PENDING' : latest.withdrawnAt ? 'WITHDRAWN' : latest.granted ? 'GRANTED' : 'DECLINED';
  }
  return out;
}

export const allows = (state: ReturnType<typeof consentState>, t: ConsentType) => state[t] === 'GRANTED';
