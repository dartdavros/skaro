// Tolerance checks for adapters (principle P3): unknown or malformed native lines must never
// break parsing. Node only; used by adapter tests.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GOLDEN_DIR } from './golden.ts';
import type { TimelineEvent } from './model.ts';
import type { Emit, ProjectionContext } from './projection.ts';
import type { Projector, RawLine } from './replay.ts';
import { Timeline } from './state.ts';

type Factory = (ctx: ProjectionContext, emit: Emit) => Projector;

const ctx: ProjectionContext = {
  now: () => 0,
  attachImage: ({ mime }) => ({ id: 'image', mime }),
};

/** Feeds lines to a fresh projector; returns the events. Throws if the projector throws. */
export function project(
  factory: Factory,
  lines: { dir: 'in' | 'out'; line: unknown }[],
): TimelineEvent[] {
  const events: TimelineEvent[] = [];
  const projector = factory(ctx, (e) => events.push(e));
  for (const { dir, line } of lines) {
    if (dir === 'in') projector.input(line);
    else projector.output(line);
  }
  Timeline.from(events);
  return events;
}

/** Small deterministic PRNG so failures are reproducible. */
function random(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const WRONG_VALUES: unknown[] = [
  null,
  42,
  'text',
  [],
  {},
  true,
  [1, 'a'],
  { nested: { deep: null } },
];

/** Replaces or deletes one random value somewhere inside `value`. */
function mutate(value: unknown, rnd: () => number): unknown {
  if (Array.isArray(value)) {
    if (!value.length || rnd() < 0.3) return WRONG_VALUES[Math.floor(rnd() * WRONG_VALUES.length)];
    const copy = [...value];
    const i = Math.floor(rnd() * copy.length);
    copy[i] = mutate(copy[i], rnd);
    return copy;
  }
  if (value && typeof value === 'object') {
    const copy = { ...(value as Record<string, unknown>) };
    const keys = Object.keys(copy);
    if (!keys.length) return WRONG_VALUES[Math.floor(rnd() * WRONG_VALUES.length)];
    const key = keys[Math.floor(rnd() * keys.length)]!;
    const roll = rnd();
    if (roll < 0.25) delete copy[key];
    else if (roll < 0.5) copy[key] = WRONG_VALUES[Math.floor(rnd() * WRONG_VALUES.length)];
    else copy[key] = mutate(copy[key], rnd);
    return copy;
  }
  return WRONG_VALUES[Math.floor(rnd() * WRONG_VALUES.length)];
}

/** Every recorded session of an agent with a share of its lines damaged, per seed. */
export function mutatedSessions(
  agent: string,
  seeds: number,
  share = 0.2,
): { name: string; lines: { dir: 'in' | 'out'; line: unknown }[] }[] {
  const root = join(GOLDEN_DIR, agent);
  const sessions: { name: string; lines: { dir: 'in' | 'out'; line: unknown }[] }[] = [];
  for (const scenario of readdirSync(root)) {
    let text: string;
    try {
      text = readFileSync(join(root, scenario, 'raw.jsonl'), 'utf8');
    } catch {
      continue;
    }
    const lines = text
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as RawLine)
      .filter((l): l is RawLine & { dir: 'in' | 'out' } => l.dir === 'in' || l.dir === 'out');
    for (let seed = 1; seed <= seeds; seed++) {
      const rnd = random(seed * 7919 + scenario.length);
      sessions.push({
        name: `${scenario}#${seed}`,
        lines: lines.map((l) => ({
          dir: l.dir,
          line: rnd() < share ? mutate(l.line, rnd) : l.line,
        })),
      });
    }
  }
  return sessions;
}
