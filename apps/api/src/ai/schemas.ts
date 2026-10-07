import { z } from 'zod';

/** All AI outputs are validated against these schemas before they touch the database. */

const key = z.string().regex(/^[a-z][a-z0-9_]{1,48}$/, 'snake_case key');

export const CompetencyFrameworkSchema = z.object({
  competencies: z
    .array(
      z.object({
        key,
        name: z.string().min(2).max(80),
        description: z.string().min(10).max(600),
        weight: z.number().min(0.5).max(3),
        requiredLevel: z.number().int().min(1).max(5),
        evaluationCriteria: z.string().max(800),
        indicators: z.array(z.string().max(200)).min(2).max(8),
        positiveExamples: z.array(z.string().max(240)).min(1).max(5),
        negativeExamples: z.array(z.string().max(240)).min(1).max(5),
        questions: z
          .array(z.object({ text: z.string().max(400), followUps: z.array(z.string().max(300)).max(4) }))
          .min(2)
          .max(5),
      }),
    )
    .min(3)
    .max(10),
});
export type CompetencyFramework = z.infer<typeof CompetencyFrameworkSchema>;

export const InterviewPlanSchema = z.object({
  name: z.string().max(120),
  stages: z
    .array(
      z.object({
        name: z.string().max(80),
        durationMinutes: z.number().int().min(10).max(180),
        competencyKeys: z.array(key).min(1).max(6),
        rationale: z.string().max(400),
      }),
    )
    .min(1)
    .max(6),
  scoringRubric: z.object({
    '1': z.string().max(300),
    '2': z.string().max(300),
    '3': z.string().max(300),
    '4': z.string().max(300),
    '5': z.string().max(300),
  }),
});
export type InterviewPlanDraft = z.infer<typeof InterviewPlanSchema>;

export const CvAnalysisSchema = z.object({
  extracted: z.object({
    currentPosition: z.string().nullable(),
    currentCompany: z.string().nullable(),
    yearsExperience: z.number().nullable(),
    skills: z.array(z.string()).max(40),
    certifications: z.array(z.string()).max(20),
    languages: z.array(z.string()).max(10),
    education: z.array(z.object({ degree: z.string(), institution: z.string(), year: z.string().nullable() })).max(8),
    employment: z
      .array(z.object({ title: z.string(), company: z.string(), from: z.string().nullable(), to: z.string().nullable() }))
      .max(15),
  }),
  jobFit: z.array(
    z.object({
      competencyKey: key,
      status: z.enum(['EVIDENCE_FOUND', 'PARTIAL', 'INSUFFICIENT_EVIDENCE']),
      evidenceFound: z.array(z.string().max(300)).max(5),
      evidenceMissing: z.string().max(300).nullable(),
      confidence: z.number().min(0).max(1),
    }),
  ),
  potentialInconsistencies: z.array(z.string().max(300)).max(6),
  suggestedProbes: z.array(z.string().max(300)).max(6),
});
export type CvAnalysis = z.infer<typeof CvAnalysisSchema>;

export const EvidenceExtractionSchema = z.object({
  items: z
    .array(
      z.object({
        segmentSeq: z.number().int().min(0),
        competencyKey: key,
        quote: z.string().min(8).max(600).describe('Verbatim substring of the referenced segment text'),
        summary: z.string().max(240),
        polarity: z.enum(['positive', 'negative']),
        type: z.enum(['OBSERVED', 'INFERRED']),
        confidence: z.number().min(0).max(1),
      }),
    )
    .max(60),
});
export type EvidenceExtraction = z.infer<typeof EvidenceExtractionSchema>;

export const CopilotSchema = z.object({
  suggestions: z
    .array(
      z.object({
        competencyKey: key,
        kind: z.enum(['FOLLOW_UP', 'PROBE_WEAK_EVIDENCE', 'CONTRADICTION', 'NEW_AREA']),
        question: z.string().max(300),
        reason: z.string().max(300),
      }),
    )
    .max(5),
  sufficientEvidence: z.boolean(),
});
export type CopilotOutput = z.infer<typeof CopilotSchema>;

export const ScoreSuggestionSchema = z.object({
  scores: z.array(
    z.object({
      competencyKey: key,
      status: z.enum(['SCORED', 'INSUFFICIENT_EVIDENCE']),
      score: z.number().int().min(1).max(5).nullable(),
      evidenceIds: z.array(z.string().uuid()).max(10),
      rationale: z.string().max(500),
    }),
  ),
});
export type ScoreSuggestion = z.infer<typeof ScoreSuggestionSchema>;

export const DecisionSummarySchema = z.object({
  overall: z.string().max(1200).describe('Evidence-based assessment. Never recommend hiring or rejecting.'),
  strengths: z.array(z.object({ text: z.string().max(300), evidenceIds: z.array(z.string().uuid()).min(1) })).max(6),
  weaknesses: z.array(z.object({ text: z.string().max(300), evidenceIds: z.array(z.string().uuid()).min(1) })).max(6),
  evidenceGaps: z.array(z.string().max(200)).max(8),
  risks: z.array(z.string().max(300)).max(6),
  consistency: z.string().max(500),
  recommendedNextStep: z.string().max(300),
});
export type DecisionSummaryContent = z.infer<typeof DecisionSummarySchema>;
