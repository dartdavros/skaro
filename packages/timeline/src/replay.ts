import type { TimelineEvent } from './model.ts';
import type { Emit, ProjectionContext } from './projection.ts';

/** Adapter projector: consumes raw lines Skaro sent (`input`) and the agent emitted (`output`). */
export interface Projector {
  input(line: unknown): void;
  output(line: unknown): void;
}

/** One line of a raw session log (fixtures/golden/<agent>/<scenario>/raw.jsonl). */
export interface RawLine {
  /** Milliseconds since the session started. */
  ts: number;
  dir: 'in' | 'out' | 'err' | 'meta';
  line: unknown;
}

/**
 * Rebuilds the canonical timeline from a raw log (principle P2). Image ids come from `hashImage`
 * so replays match what the recorder stored in attachments/.
 */
export function replayRawLog(
  rawJsonl: string,
  createProjector: (ctx: ProjectionContext, emit: Emit) => Projector,
  hashImage: (base64: string) => string,
): TimelineEvent[] {
  const events: TimelineEvent[] = [];
  let now = 0;
  const projector = createProjector(
    {
      now: () => now,
      attachImage: ({ base64, mime, width, height, path }) => ({
        id: hashImage(base64),
        mime,
        width,
        height,
        path,
      }),
    },
    (event) => events.push(event),
  );
  for (const text of rawJsonl.split('\n')) {
    if (!text.trim()) continue;
    const raw = JSON.parse(text) as RawLine;
    now = raw.ts;
    if (raw.dir === 'in') projector.input(raw.line);
    else if (raw.dir === 'out') projector.output(raw.line);
  }
  return events;
}
