import { AIProvider, AIProviderUnavailableError, StructuredRequest, StructuredResult } from './provider';

/**
 * Placeholders that satisfy the AIProvider contract so an organization can be pointed
 * at another approved provider later (e.g. Gemini, or a private model for on-prem /
 * data-residency customers). Claude (AnthropicProvider) is the default and only active one.
 */
export class GeminiProvider implements AIProvider {
  readonly name = 'gemini';
  async generateStructured<T>(_req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    throw new AIProviderUnavailableError('Gemini provider is not enabled in this deployment');
  }
}

export class LocalLLMProvider implements AIProvider {
  readonly name = 'local';
  async generateStructured<T>(_req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    throw new AIProviderUnavailableError('Local LLM provider is not enabled in this deployment');
  }
}
