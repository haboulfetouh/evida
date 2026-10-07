import type { Principal } from '../common/context';
import { permissionsFor } from '../common/permissions';

/**
 * Blind review: evaluators (people who score or decide but do not manage the pipeline) see
 * candidates without identifying or demographic fields. Recruiters/admins still see them.
 * EVIDA never infers demographic attributes; it only hides fields that were provided.
 */
export function isBlind(user: Principal, orgBlindReview: boolean): boolean {
  return orgBlindReview && !permissionsFor(user.roles).has('candidate.update');
}

export function blindLabel(candidateId: string) {
  return `Candidate ${candidateId.slice(0, 4).toUpperCase()}`;
}

export function maskCandidate<T extends { id: string; name: string; email?: string; phone?: string | null; location?: string | null; linkedinUrl?: string | null }>(c: T, blind: boolean): T {
  if (!blind) return c;
  return { ...c, name: blindLabel(c.id), email: '', phone: null, location: null, linkedinUrl: null, salaryExpectation: null, blind: true } as T;
}
