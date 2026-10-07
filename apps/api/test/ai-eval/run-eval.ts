/** CLI: ANTHROPIC_API_KEY=... npm run eval:ai  — exits non-zero when thresholds are not met. */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { AnthropicProvider } from '../../src/ai/anthropic.provider';
import { runEval, type EvalDataset } from './harness';

(async () => {
  const data = JSON.parse(readFileSync(path.join(__dirname, 'dataset.json'), 'utf8')) as EvalDataset;
  const model = process.env.AI_MODEL_FAST ?? 'claude-haiku-4-5-20251001';
  const report = await runEval(new AnthropicProvider(process.env.ANTHROPIC_API_KEY), data, model);
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.passed ? 0 : 1);
})().catch((e) => {
  console.error(e.message);
  process.exit(2);
});
