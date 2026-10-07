# AI design and governance

EVIDA is **human-led, AI-assisted**. AI drafts, extracts, suggests and summarises; it never makes, recommends or
forces a hiring decision.

## Provider architecture

```
domain code → AiService.run(prompt, input, meta) → AIProvider.generateStructured()
                          │                              ├─ AnthropicProvider (Claude) — active
                          │                              ├─ GeminiProvider — placeholder, disabled
                          │                              └─ LocalLLMProvider — placeholder, disabled
                          └─ AIProcessingRun row (prompt id+version, provider, model, tokens, cost, latency, status) + audit
```

The provider is chosen per organisation (`Organization.aiProvider`). A circuit breaker opens after repeated failures
so outages degrade gracefully (features show "AI not available" and humans continue manually).

## Models (Claude)

| Tier | Default | Used for | Why |
|---|---|---|---|
| Reasoning | `claude-sonnet-5-5` | competency frameworks, interview plans, score suggestions, decision summaries | multi-step synthesis over the whole case |
| Fast | `claude-haiku-4-5-20251001` | CV analysis, evidence extraction, live copilot | high volume, low latency, lower cost |

Model ids are configuration (`AI_MODEL_REASONING`, `AI_MODEL_FAST`); changing either requires the evaluation suite
to pass first.

## Prompt registry

`apps/api/src/ai/prompts/index.ts` — each prompt has id, version, purpose, owner, tier, temperature, token limit,
evaluation criteria, created/approved dates, system instructions, input builder and output schema (Zod →
JSON Schema tool). Prompts live only on the server; the AI Governance Center lists them.

| Prompt | Output | Guard after the model |
|---|---|---|
| `competency_framework.generate` | competencies, indicators, examples, questions | saved as `AI_GENERATED`; must be approved before use |
| `interview_plan.generate` | rounds, durations, competency keys, rubric | unknown keys dropped; plan saved as DRAFT |
| `cv.analyze` | extracted profile, job-fit per competency | only fills empty fields; labelled informational; never rejects |
| `evidence.extract` | segment seq, competency, verbatim quote, polarity, type, confidence | hallucination guard (below) |
| `copilot.suggest` | ≤ 3 follow-up questions with reasons | competencies outside the stage dropped; shown as suggestions |
| `score.suggest` | score or `INSUFFICIENT_EVIDENCE` + evidence ids | ids must exist and match the competency, else insufficient |
| `decision.summary` | overall, strengths/weaknesses with evidence ids, gaps, risks, next step | uncited claims dropped; decision language refused |

## Hallucination controls

1. Structured output only (forced tool use + Zod; one corrective retry).
2. Evidence is kept only if the segment exists, the speaker is the candidate, the quote is a verbatim substring
   (whitespace/quote-normalised) and the competency belongs to the job; duplicates are removed.
3. `INFERRED` evidence is labelled and capped at 0.7 confidence; unreviewed AI evidence counts at half weight and
   can never make a competency "sufficient" without a human-validated item.
4. Linking evidence to a submitted score is an explicit human confirmation.
5. Scores and summaries must cite evidence ids that exist in the case.

## Consent and privacy

AI runs only with the candidate's `AI_ANALYSIS` consent (and transcripts require `TRANSCRIPTION`). Withdrawal stops
processing and deletes unvalidated AI evidence and AI score suggestions. No emotion, face, voice, accent or personality
analysis; protected characteristics are never inferred. Only the minimum context (one case) is sent per call.

## Evaluation

`apps/api/test/ai-eval` contains a labelled synthetic dataset (including prompt-injection and interviewer-speech
traps) and a harness reporting recall, precision, hallucination (guard-rejection) rate and run-to-run consistency
against thresholds (`recall ≥ 0.8`, `precision ≥ 0.8`, `hallucination ≤ 0.15`, `consistency ≥ 0.8`).
`npm run eval:ai` runs it against Claude; CI runs it on pull requests touching AI code. Extend the dataset with
anonymised, consented examples from your own interview loops before each model change. Better-looking summaries
alone are not a reason to change models.

## Cost management

Every run records input/output tokens and cost (`AI_PRICE_*`). The analytics "AI usage" tab shows cost per purpose,
per interview, latency p50/p95, failure rate, suggestion acceptance and human override rates. Live extraction is
debounced (20 s windows) and incremental (only new segments), and full-pipeline jobs are idempotent.
