import type { ZodType } from 'zod';

export interface StructuredRequest<T> {
  model: string;
  system: string;
  user: string;
  /** Zod schema the model output must satisfy. Free-form output is never accepted. */
  schema: ZodType<T>;
  toolName: string;
  toolDescription: string;
  maxTokens: number;
  temperature: number;
}

export interface StructuredResult<T> {
  data: T;
  model: string;
  usage: { inputTokens: number; outputTokens: number };
}

/**
 * Provider-neutral contract. Business code depends only on this interface,
 * so the provider can be swapped per organization without touching domain logic.
 */
export interface AIProvider {
  readonly name: string;
  generateStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>>;
}

export class AISchemaError extends Error {
  constructor(message: string, readonly issues: unknown) {
    super(message);
  }
}

export class AIProviderUnavailableError extends Error {}
