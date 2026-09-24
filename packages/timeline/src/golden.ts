// Golden test helper for adapters (Node only; not exported from the package root).
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Emit, ProjectionContext } from './projection.ts';
import { replayRawLog, type Projector } from './replay.ts';

const GOLDEN = fileURLToPath(new URL('../../../fixtures/golden/', import.meta.url));

export interface GoldenCase {
  scenario: string;
  expected: string[];
  actual: string[];
}

/** Replays every recorded session of an agent and pairs the result with the stored canonical.jsonl. */
export function goldenCases(
  agent: string,
  createProjector: (ctx: ProjectionContext, emit: Emit) => Projector,
): GoldenCase[] {
  const root = join(GOLDEN, agent);
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .filter((scenario) => existsSync(join(root, scenario, 'raw.jsonl')))
    .map((scenario) => {
      const dir = join(root, scenario);
      const events = replayRawLog(
        readFileSync(join(dir, 'raw.jsonl'), 'utf8'),
        createProjector,
        (base64) => createHash('sha256').update(Buffer.from(base64, 'base64')).digest('hex'),
      );
      return {
        scenario,
        expected: readFileSync(join(dir, 'canonical.jsonl'), 'utf8').split('\n').filter(Boolean),
        actual: events.map((e) => JSON.stringify(e)),
      };
    });
}
