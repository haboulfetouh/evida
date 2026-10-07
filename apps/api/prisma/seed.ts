/**
 * Seed for the dedicated demo environment ONLY. Every record is synthetic and labelled as such.
 * No AI output is fabricated: evidence below is entered as interviewer-added (HUMAN_ADDED) demo data,
 * and AI features run for real once ANTHROPIC_API_KEY is configured.
 *
 *   SEED_PASSWORD=... npm run db:seed      (refuses to run with NODE_ENV=production)
 */
import 'dotenv/config';
import argon2 from 'argon2';
import { createPrismaClient } from '../src/common/prisma.service';
import { randomToken, sha256 } from '../src/common/crypto';
import { defaultRubric } from '../src/modules/jobs/plans.controller';

async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('Refusing to seed demo data in production');
  const prisma = createPrismaClient(process.env.DATABASE_URL);
  const password = process.env.SEED_PASSWORD ?? 'EvidaDemo!2026';
  const hash = await argon2.hash(password, { type: argon2.argon2id });

  const existing = await prisma.organization.findUnique({ where: { slug: 'evida-demo' } });
  if (existing) {
    console.log('Demo organization already exists — skipping.');
    await prisma.$disconnect();
    return;
  }

  const org = await prisma.organization.create({
    data: { name: 'EVIDA Demo Corporation', slug: 'evida-demo', locale: 'en', recordingEnabled: true, blindReviewEnabled: false },
  });
  const mk = (email: string, name: string, roles: any[]) => prisma.user.create({ data: { organizationId: org.id, email, name, roles, passwordHash: hash } });
  const admin = await mk('admin@demo.evida.local', 'Hana Admin (demo)', ['ORG_ADMIN', 'HR_DIRECTOR']);
  const recruiter = await mk('recruiter@demo.evida.local', 'Omar Recruiter (demo)', ['RECRUITER']);
  const manager = await mk('manager@demo.evida.local', 'Laila Hiring Manager (demo)', ['HIRING_MANAGER']);
  const interviewer = await mk('interviewer@demo.evida.local', 'Karim Interviewer (demo)', ['INTERVIEWER']);

  const job = await prisma.job.create({
    data: {
      organizationId: org.id, title: 'Senior Engineering Manager', department: 'Engineering', location: 'Cairo (hybrid)', employmentType: 'Full-time',
      description:
        'Lead three product engineering teams (25–40 engineers) building our customer platform. Own delivery, engineering standards, hiring and people development, and partner with product on strategy and commercial outcomes.',
      requiredExperience: '10+ years in software, 4+ managing managers', requiredSkills: ['Engineering leadership', 'Delivery management', 'Distributed systems'],
      preferredSkills: ['Fintech', 'Arabic & English'], positions: 1, status: 'OPEN', hiringManagerId: manager.id, recruiterId: recruiter.id, openingDate: new Date(),
    },
  });

  const comps = [
    ['technical_leadership', 'Technical Leadership', 'Sets technical direction, raises engineering standards and makes sound architectural trade-offs.', 1.5],
    ['people_management', 'People Management', 'Hires, develops and retains strong engineers and managers; handles performance issues fairly and early.', 1.5],
    ['strategic_thinking', 'Strategic Thinking', 'Connects engineering investments to business strategy and plans beyond the current quarter.', 1],
    ['communication', 'Communication', 'Communicates clearly with engineers, executives and customers; adapts message to audience.', 1],
    ['delivery_management', 'Delivery Management', 'Delivers predictably: planning, risk management, removing blockers, measurable outcomes.', 1.2],
    ['business_acumen', 'Business Acumen', 'Understands commercial drivers, costs and customer value; makes trade-offs with business impact in mind.', 1],
  ] as const;
  const questions: Record<string, [string, string[]][]> = {
    technical_leadership: [['Tell us about a technical standard you introduced across several teams. How did you get adoption?', ['What resistance did you face?', 'How did you measure the impact?']]],
    people_management: [['Describe a time you handled an underperforming team member.', ['What did you do first?', 'What was the outcome for the person and the team?']], ['How have you grown a senior engineer into a manager?', ['What did you delegate?']]],
    strategic_thinking: [['Tell us about a multi-quarter engineering investment you championed.', ['How did you tie it to business goals?']]],
    communication: [['Describe a difficult message you had to deliver to executives.', ['How did you prepare?']]],
    delivery_management: [['Walk us through a delivery that was at risk. What did you change?', ['Which metrics did you use?']]],
    business_acumen: [['Give an example of a trade-off where you weighed engineering cost against commercial value.', ['What was the financial impact?']]],
  };
  const created: Record<string, string> = {};
  for (const [key, name, description, weight] of comps) {
    const c = await prisma.competency.create({
      data: {
        organizationId: org.id, jobId: job.id, key, name, description, weight, requiredLevel: 4, origin: 'HUMAN',
        indicators: ['Gives concrete, first-person examples', 'Describes measurable outcomes', 'Reflects on what they would do differently'],
        positiveExamples: ['Specific situation, own actions and quantified result'], negativeExamples: ['Generic statements without examples'],
        questions: { create: questions[key].map(([text, followUps], i) => ({ organizationId: org.id, text, followUps, order: i, origin: 'HUMAN' as const })) },
      },
    });
    created[key] = c.id;
  }

  const plan = await prisma.interviewPlan.create({
    data: {
      organizationId: org.id, jobId: job.id, name: 'Senior Engineering Manager — standard loop', status: 'ACTIVE', origin: 'HUMAN', scoringRubric: defaultRubric, approvedById: manager.id, approvedAt: new Date(),
      stages: {
        create: [
          { organizationId: org.id, name: 'HR Screening', order: 0, durationMinutes: 30, competencyKeys: ['communication'] },
          { organizationId: org.id, name: 'Leadership Interview', order: 1, durationMinutes: 60, competencyKeys: ['technical_leadership', 'people_management', 'delivery_management'] },
          { organizationId: org.id, name: 'Final Interview', order: 2, durationMinutes: 45, competencyKeys: ['strategic_thinking', 'business_acumen'] },
        ],
      },
    },
    include: { stages: { orderBy: { order: 'asc' } } },
  });

  const candidate = await prisma.candidate.create({
    data: {
      organizationId: org.id, name: '[SYNTHETIC] Nour Example', email: 'nour.example@synthetic.evida.local', currentCompany: 'Example Fintech (synthetic)',
      currentPosition: 'Engineering Manager', yearsExperience: 12, skills: ['Engineering leadership', 'Kubernetes', 'Hiring'], source: 'Demo seed', isSynthetic: true,
      recruiterNotes: 'Synthetic demo candidate. Not a real person.',
      applications: { create: { organizationId: org.id, jobId: job.id, stage: 'INTERVIEW_COMPLETED' } },
    },
    include: { applications: true },
  });
  const appId = candidate.applications[0].id;

  // Completed leadership interview with a synthetic transcript and interviewer-entered evidence.
  const done = await prisma.interview.create({
    data: {
      organizationId: org.id, applicationId: appId, stageId: plan.stages[1].id, scheduledAt: new Date(Date.now() - 2 * 86_400_000), durationMinutes: 60,
      status: 'COMPLETED', startedAt: new Date(Date.now() - 2 * 86_400_000), endedAt: new Date(Date.now() - 2 * 86_400_000 + 58 * 60_000),
      roomName: `evida-${randomToken(18).toLowerCase().replace(/[^a-z0-9]/g, '')}`,
      participants: { create: [{ userId: interviewer.id, isLead: true }, { userId: manager.id }] },
      consents: { create: ['TRANSCRIPTION', 'AI_ANALYSIS'].map((t) => ({ organizationId: org.id, type: t as any, granted: true, version: org.consentPolicyVersion, userAgent: 'seed' })) },
    },
  });
  const lines: [string, number, string][] = [
    ['INTERVIEWER: Karim Interviewer (demo)', 30, 'Tell us about a technical standard you introduced across several teams. How did you get adoption?'],
    ['CANDIDATE', 45, 'At my last company I led about 35 engineers across four teams. I introduced a shared code review and release checklist, and we cut our release cycle from three weeks to one week over two quarters.'],
    ['INTERVIEWER: Karim Interviewer (demo)', 140, 'How did you handle an underperforming team member?'],
    ['CANDIDATE', 152, 'I had a senior engineer missing commitments. I set weekly one-to-ones, agreed three concrete goals with him, and after eight weeks he was back to leading the payments migration.'],
    ['INTERVIEWER: Laila Hiring Manager (demo)', 300, 'Walk us through a delivery that was at risk.'],
    ['CANDIDATE', 312, 'Our card issuing launch slipped by a month. I split the scope into two releases, moved two engineers from a lower-priority project, and we shipped the first release on the original date.'],
  ];
  const transcript = await prisma.transcript.create({ data: { interviewId: done.id, source: 'seed' } });
  const segs: { id: string; startSec: number }[] = [];
  for (let i = 0; i < lines.length; i++) {
    segs.push(await prisma.transcriptSegment.create({ data: { transcriptId: transcript.id, seq: i, speaker: lines[i][0], startSec: lines[i][1], endSec: lines[i + 1]?.[1] ?? lines[i][1] + 60, text: lines[i][2] } }));
  }
  const ev = (seg: number, comp: string, quote: string, summary: string) =>
    prisma.evidence.create({
      data: { organizationId: org.id, interviewId: done.id, competencyId: created[comp], segmentId: segs[seg].id, quote, summary, speaker: 'CANDIDATE', timestampSec: segs[seg].startSec, confidence: 1, status: 'HUMAN_ADDED', validatedById: interviewer.id, validatedAt: new Date() },
    });
  await ev(1, 'technical_leadership', 'I introduced a shared code review and release checklist', 'Introduced cross-team engineering standards (synthetic demo evidence)');
  await ev(1, 'delivery_management', 'we cut our release cycle from three weeks to one week over two quarters', 'Reduced release cycle 3w → 1w (synthetic demo evidence)');
  await ev(3, 'people_management', 'I set weekly one-to-ones, agreed three concrete goals with him', 'Structured performance management (synthetic demo evidence)');
  await prisma.interview.update({ where: { id: done.id }, data: { aiProcessedSeq: -1 } });

  // Upcoming final interview with a working candidate link.
  const token = randomToken();
  const upcoming = await prisma.interview.create({
    data: {
      organizationId: org.id, applicationId: appId, stageId: plan.stages[2].id, scheduledAt: new Date(Date.now() + 86_400_000), durationMinutes: 45,
      roomName: `evida-${randomToken(18).toLowerCase().replace(/[^a-z0-9]/g, '')}`, candidateTokenHash: sha256(token), candidateTokenExpiresAt: new Date(Date.now() + 8 * 86_400_000),
      participants: { create: [{ userId: manager.id, isLead: true }, { userId: interviewer.id }] },
    },
  });

  await prisma.auditLog.create({ data: { organizationId: org.id, actorType: 'SYSTEM', action: 'seed.demo', resourceType: 'organization', resourceId: org.id, metadata: { synthetic: true } } });
  console.log('Seeded EVIDA Demo Corporation (synthetic data).');
  console.log(`  Users (password: ${process.env.SEED_PASSWORD ? '<SEED_PASSWORD>' : password}):`);
  for (const u of [admin, recruiter, manager, interviewer]) console.log(`   - ${u.email}`);
  console.log(`  Candidate portal link for the upcoming interview: ${process.env.WEB_ORIGIN ?? 'http://localhost:3000'}/c/${token}`);
  console.log(`  Upcoming interview id: ${upcoming.id}`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
