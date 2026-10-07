import type { Role } from '../db';

/** Granular permissions. Controllers declare what they need; roles grant sets of them. */
export const PERMISSIONS = [
  'org.manage',
  'user.manage',
  'job.read',
  'job.write',
  'competency.write',
  'competency.approve',
  'plan.write',
  'plan.approve',
  'candidate.read',
  'candidate.create',
  'candidate.update',
  'cv.download',
  'interview.read',
  'interview.create',
  'interview.conduct',
  'interview.score',
  'transcript.read',
  'transcript.write',
  'recording.access',
  'evidence.read',
  'evidence.approve',
  'decision.read',
  'decision.create',
  'analytics.read',
  'audit.read',
  'ai.governance.read',
  'integration.manage',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const ALL = [...PERMISSIONS] as Permission[];

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  SYSTEM_ADMIN: ALL,
  ORG_ADMIN: ALL,
  HR_DIRECTOR: ALL.filter((p) => !['org.manage', 'integration.manage'].includes(p)),
  RECRUITER: [
    'job.read', 'job.write', 'competency.write', 'competency.approve', 'plan.write', 'plan.approve',
    'candidate.read', 'candidate.create', 'candidate.update', 'cv.download',
    'interview.read', 'interview.create', 'transcript.read', 'transcript.write',
    'evidence.read', 'decision.read', 'analytics.read',
  ],
  HIRING_MANAGER: [
    'job.read', 'job.write', 'competency.write', 'competency.approve', 'plan.write', 'plan.approve',
    'candidate.read', 'cv.download', 'interview.read', 'interview.conduct', 'interview.score',
    'transcript.read', 'transcript.write', 'evidence.read', 'evidence.approve', 'decision.read', 'decision.create', 'analytics.read',
  ],
  // Interviewers get resource-scoped access: only interviews they are assigned to (see InterviewAccess).
  INTERVIEWER: [
    'interview.read', 'interview.conduct', 'interview.score', 'transcript.read', 'transcript.write',
    'evidence.read', 'evidence.approve',
  ],
  VIEWER: ['job.read', 'candidate.read', 'interview.read', 'evidence.read', 'decision.read', 'analytics.read'],
};

export function permissionsFor(roles: Role[]): Set<Permission> {
  const out = new Set<Permission>();
  for (const r of roles) for (const p of ROLE_PERMISSIONS[r] ?? []) out.add(p);
  return out;
}

/** Roles whose access is not limited to interviews they are assigned to. */
export function hasOrgWideInterviewAccess(roles: Role[]): boolean {
  return roles.some((r) => r !== 'INTERVIEWER' && r !== 'VIEWER');
}
