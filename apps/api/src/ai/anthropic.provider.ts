import Anthropic from '@anthropic-ai/sdk';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { AIProvider, AIProviderUnavailableError, AISchemaError, StructuredRequest, StructuredResult } from './provider';

/**
 * Claude adapter. Structured output is obtained through forced tool use:
 * the model must call a single tool whose input_schema is derived from the Zod schema,
 * and the tool input is then re-validated with Zod before anything is persisted.
 */
export class AnthropicProvider implements AIProvider {
  readonly name = 'anthropic';
  private readonly client: Anthropic;

  constructor(apiKey: string | undefined, private readonly timeoutMs = 90_000) {
    if (!apiKey) throw new AIProviderUnavailableError('ANTHROPIC_API_KEY is not configured');
    this.client = new Anthropic({ apiKey, timeout: timeoutMs, maxRetries: 2 });
  }

  async generateStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    const jsonSchema = zodToJsonSchema(req.schema as any, { target: 'jsonSchema7', $refStrategy: 'none' }) as Record<string, unknown>;
    delete jsonSchema.$schema;

    const messages: Anthropic.MessageParam[] = [{ role: 'user', content: req.user }];
    let inputTokens = 0;
    let outputTokens = 0;
    let lastIssues: unknown;

    // One corrective retry if the output fails schema validation.
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await this.client.messages.create({
        model: req.model,
        max_tokens: req.maxTokens,
        system: req.system,
        tools: [
          {
            name: req.toolName,
            description: req.toolDescription,
            input_schema: jsonSchema as Anthropic.Tool.InputSchema,
          },
        ],
        tool_choice: { type: 'tool', name: req.toolName },
        messages,
      });
      inputTokens += res.usage.input_tokens;
      outputTokens += res.usage.output_tokens;

      const block = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
      if (!block) throw new AISchemaError('Model did not return structured output', null);

      const parsed = req.schema.safeParse(block.input);
      if (parsed.success) {
        return { data: parsed.data, model: res.model, usage: { inputTokens, outputTokens } };
      }
      lastIssues = parsed.error.issues;
      messages.push({ role: 'assistant', content: res.content });
      messages.push({
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: block.id,
            is_error: true,
            content: `Output failed validation: ${JSON.stringify(parsed.error.issues).slice(0, 2000)}. Call the tool again with corrected input.`,
          },
        ],
      });
    }
    throw new AISchemaError('Model output failed schema validation', lastIssues);
  }
}
