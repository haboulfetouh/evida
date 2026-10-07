import { describe, expect, it } from 'vitest';
import jwt from 'jsonwebtoken';
import { signWebhook, verifyWebhook } from '../../src/common/crypto';
import { permissionsFor, hasOrgWideInterviewAccess } from '../../src/common/permissions';
import { jitsiToken } from '../../src/infra/jitsi';
import { renderEmail } from '../../src/infra/templates';
import { isBlind, maskCandidate } from '../../src/domain/blind';

describe('webhook signatures', () => {
  it('verifies HMAC and rejects tampering and replays', () => {
    const now = 1_800_000_000;
    const { timestamp, signature } = signWebhook('s3cret', '{"a":1}', now);
    expect(verifyWebhook('s3cret', '{"a":1}', timestamp, signature, 300, now)).toBe(true);
    expect(verifyWebhook('s3cret', '{"a":2}', timestamp, signature, 300, now)).toBe(false);
    expect(verifyWebhook('other', '{"a":1}', timestamp, signature, 300, now)).toBe(false);
    expect(verifyWebhook('s3cret', '{"a":1}', timestamp, signature, 300, now + 301)).toBe(false);
  });
});

describe('RBAC', () => {
  it('grants least privilege per role', () => {
    const interviewer = permissionsFor(['INTERVIEWER']);
    expect(interviewer.has('interview.score')).toBe(true);
    expect(interviewer.has('decision.create')).toBe(false);
    expect(interviewer.has('candidate.read')).toBe(false);
    expect(interviewer.has('audit.read')).toBe(false);
    expect(permissionsFor(['VIEWER']).has('evidence.approve')).toBe(false);
    expect(permissionsFor(['HIRING_MANAGER']).has('decision.create')).toBe(true);
    expect(permissionsFor(['RECRUITER']).has('decision.create')).toBe(false);
    expect(hasOrgWideInterviewAccess(['INTERVIEWER'])).toBe(false);
    expect(hasOrgWideInterviewAccess(['INTERVIEWER', 'RECRUITER'])).toBe(true);
  });
});

describe('Jitsi tokens', () => {
  it('are room-scoped, short-lived and grant recording only when allowed', () => {
    const t = jitsiToken({ roomName: 'evida-abc', user: { id: 'u', name: 'N' }, moderator: false, recording: false, transcription: false });
    const c = jwt.verify(t, 'test-jitsi-secret') as any;
    expect(c.room).toBe('evida-abc');
    expect(c.context.user.moderator).toBe(false);
    expect(c.context.features.recording).toBe(false);
    expect(c.exp - c.nbf).toBeLessThanOrEqual(7200 + 10);
  });
});

describe('email templates', () => {
  it('escape interpolated values and render Arabic RTL', () => {
    const m = renderEmail('interview_invitation', 'ar', { candidate: '<script>x</script>', job: 'مدير', org: 'O', stage: 'S', duration: 30, when: 'w', url: 'https://x' });
    expect(m.html).toContain('dir="rtl"');
    expect(m.html).not.toContain('<script>');
    expect(m.subject).toContain('مدير');
  });
});

describe('blind review', () => {
  const principal = (roles: any[]) => ({ kind: 'USER' as const, userId: 'u', organizationId: 'o', roles, name: 'n', email: 'e' });
  it('hides identity from evaluators but not from recruiters', () => {
    expect(isBlind(principal(['INTERVIEWER']), true)).toBe(true);
    expect(isBlind(principal(['RECRUITER']), true)).toBe(false);
    expect(isBlind(principal(['INTERVIEWER']), false)).toBe(false);
    const m = maskCandidate({ id: 'abcd1234', name: 'Real Name', email: 'r@x', phone: '1', location: 'Cairo', linkedinUrl: null }, true);
    expect(m.name).toBe('Candidate ABCD');
    expect(m.email).toBe('');
    expect(m.location).toBeNull();
  });
});
