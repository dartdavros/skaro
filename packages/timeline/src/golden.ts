// Golden test helper for adapters (Node only; not exported from the package root).
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Emit, ProjectionContext } from './projection.ts';
import { replayRawLog, type Projector } from './replay.ts';
import { Timeline } from './state.ts';

export const GOLDEN_DIR = fileURLToPath(new URL('../../../fixtures/golden/', import.meta.url));

export interface GoldenCase {
  scenario: string;
  dir: string;
  /** canonical.jsonl lines as recorded and as replayed now. */
  expected: string[];
  actual: string[];
  /** timeline.json: the assembled timeline, as recorded and as replayed now. */
  expectedTimeline: unknown;
  actualTimeline: unknown;
}

export function hashImage(base64: string): string {
  return createHash('sha256').update(Buffer.from(base64, 'base64')).digest('hex');
}

/** Replays every recorded session of an agent and pairs the results with the stored files. */
export function goldenCases(
  agent: string,
  createProjector: (ctx: ProjectionContext, emit: Emit) => Projector,
): GoldenCase[] {
  const root = join(GOLDEN_DIR, agent);
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .filter((scenario) => existsSync(join(root, scenario, 'raw.jsonl')))
    .map((scenario) => {
      const dir = join(root, scenario);
      const events = replayRawLog(
        readFileSync(join(dir, 'raw.jsonl'), 'utf8'),
        createProjector,
        hashImage,
      );
      const timelinePath = join(dir, 'timeline.json');
      return {
        scenario,
        dir,
        expected: readFileSync(join(dir, 'canonical.jsonl'), 'utf8').split('\n').filter(Boolean),
        actual: events.map((e) => JSON.stringify(e)),
        expectedTimeline: existsSync(timelinePath)
          ? (JSON.parse(readFileSync(timelinePath, 'utf8')) as unknown)
          : undefined,
        actualTimeline: JSON.parse(JSON.stringify(Timeline.from(events).state)) as unknown,
      };
    });
}

/** Rewrites canonical.jsonl and timeline.json after an intended adapter change. */
export function updateGolden(c: Pick<GoldenCase, 'dir' | 'actual' | 'actualTimeline'>): void {
  writeFileSync(join(c.dir, 'canonical.jsonl'), c.actual.map((line) => `${line}\n`).join(''));
  writeFileSync(join(c.dir, 'timeline.json'), `${JSON.stringify(c.actualTimeline, null, 2)}\n`);
}

/** Rebuilds canonical.jsonl and timeline.json of one recorded session from its raw.jsonl. */
export function rebuildGolden(
  dir: string,
  createProjector: (ctx: ProjectionContext, emit: Emit) => Projector,
): number {
  const events = replayRawLog(
    readFileSync(join(dir, 'raw.jsonl'), 'utf8'),
    createProjector,
    hashImage,
  );
  updateGolden({
    dir,
    actual: events.map((e) => JSON.stringify(e)),
    actualTimeline: Timeline.from(events).state,
  });
  return events.length;
}
