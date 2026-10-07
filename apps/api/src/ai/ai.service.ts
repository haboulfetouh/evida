import { Injectable } from '@nestjs/common';
import { env } from '../config';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../common/audit.service';
import { logger } from '../common/logger';
import { AIProvider, AISchemaError } from './provider';
import { AnthropicProvider } from './anthropic.provider';
import { GeminiProvider, LocalLLMProvider } from './other.providers';
import type { PromptDefinition } from './prompts';

export interface AiRunMeta {
  organizationId: string;
  subjectType: string;
  subjectId: string;
}

/** Simple in-process circuit breaker so a provider outage degrades gracefully instead of piling up. */
class CircuitBreaker {
  private failures = 0;
  private openUntil = 0;
  constructor(private readonly threshold = 5, private readonly coolDownMs = 60_000) {}
  assertClosed() {
    if (Date.now() < this.openUntil) throw new Error('AI provider circuit open — temporarily unavailable');
  }
  success() {
    this.failures = 0;
  }
  failure() {
    if (++this.failures >= this.threshold) this.openUntil = Date.now() + this.coolDownMs;
  }
}

@Injectable()
export class AiService {
  /** Extra providers by name (e.g. an on-prem adapter, or a deterministic fake in automated tests). */
  static readonly registered = new Map<string, AIProvider>();
  private providers = new Map<string, AIProvider>();
  private breaker = new CircuitBreaker();

  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  private provider(name: string): AIProvider {
    const reg = AiService.registered.get(name);
    if (reg) return reg;
    let p = this.providers.get(name);
    if (!p) {
      p = name === 'gemini' ? new GeminiProvider() : name === 'local' ? new LocalLLMProvider() : new AnthropicProvider(env().ANTHROPIC_API_KEY);
      this.providers.set(name, p);
    }
    return p;
  }

  modelFor(tier: 'fast' | 'reasoning') {
    const e = env();
    return tier === 'fast'
      ? { model: e.AI_MODEL_FAST, inPrice: e.AI_PRICE_FAST_IN, outPrice: e.AI_PRICE_FAST_OUT }
      : { model: e.AI_MODEL_REASONING, inPrice: e.AI_PRICE_REASONING_IN, outPrice: e.AI_PRICE_REASONING_OUT };
  }

  /** Run a registered prompt, validate output, and record a governance/cost entry. */
  async run<TIn, TOut>(prompt: PromptDefinition<TIn, TOut>, input: TIn, meta: AiRunMeta): Promise<{ data: TOut; runId: string }> {
    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: meta.organizationId }, select: { aiProvider: true } });
    const providerName = org.aiProvider || env().AI_PROVIDER;
    const { model, inPrice, outPrice } = this.modelFor(prompt.tier);
    const started = Date.now();
    this.breaker.assertClosed();

    try {
      const res = await this.provider(providerName).generateStructured({
        model,
        system: prompt.system,
        user: prompt.buildUser(input),
        schema: prompt.outputSchema,
        toolName: prompt.toolName,
        toolDescription: prompt.toolDescription,
        maxTokens: prompt.maxTokens,
        temperature: prompt.temperature,
      });
      this.breaker.success();
      const cost = (res.usage.inputTokens * inPrice + res.usage.outputTokens * outPrice) / 1_000_000;
      const run = await this.prisma.aIProcessingRun.create({
        data: {
          organizationId: meta.organizationId,
          purpose: prompt.id,
          promptVersion: prompt.version,
          provider: providerName,
          model: res.model,
          subjectType: meta.subjectType,
          subjectId: meta.subjectId,
          status: 'SUCCEEDED',
          inputTokens: res.usage.inputTokens,
          outputTokens: res.usage.outputTokens,
          costUsd: cost,
          latencyMs: Date.now() - started,
        },
      });
      await this.audit.log({
        action: 'ai.process',
        resourceType: meta.subjectType,
        resourceId: meta.subjectId,
        organizationId: meta.organizationId,
        actorType: 'SYSTEM',
        metadata: { prompt: prompt.id, version: prompt.version, model: res.model, runId: run.id },
      });
      return { data: res.data, runId: run.id };
    } catch (err) {
      this.breaker.failure();
      const status = err instanceof AISchemaError ? 'REJECTED_SCHEMA' : 'FAILED';
      await this.prisma.aIProcessingRun.create({
        data: {
          organizationId: meta.organizationId,
          purpose: prompt.id,
          promptVersion: prompt.version,
          provider: providerName,
          model,
          subjectType: meta.subjectType,
          subjectId: meta.subjectId,
          status,
          latencyMs: Date.now() - started,
          error: (err as Error).message.slice(0, 500),
        },
      });
      logger.warn({ prompt: prompt.id, status, err: (err as Error).message }, 'ai_run_failed');
      throw err;
    }
  }
}
