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
 * Skaro's own lines in a run log (`dir: 'meta'`): a new agent process starts (after a restart the
 * adapter begins with a fresh projector), or an event Skaro itself adds to the feed (merge card,
 * restored session). Older logs may hold other kinds (worktree snapshots); replays skip them.
 */
export type RunLogMeta =
  | { skaro: 'segment'; agent: string; adapterVersion: string }
  | { skaro: 'event'; event: TimelineEvent };

export function isRunLogMeta(line: unknown): line is RunLogMeta {
  return typeof line === 'object' && line !== null && 'skaro' in line;
}

/**
 * Every segment of a run log is a new agent process whose projector numbers turns from the start
 * again ("turn-1" after a restart). Turns of later segments get the segment in their id, so a new
 * turn never lands in an old, finished one. Live sessions and replays number segments alike.
 */
export function segmentTurns(segment: number, event: TimelineEvent): TimelineEvent {
  if (segment <= 0) return event;
  const id = (turnId: string): string => (turnId ? `s${segment}.${turnId}` : turnId);
  switch (event.t) {
    case 'turn.started':
    case 'turn.completed':
      return { ...event, turnId: id(event.turnId) };
    case 'item.upsert':
      return { ...event, item: { ...event.item, turnId: id(event.item.turnId) } };
    default:
      return event;
  }
}

/** Segments a run log holds: the next agent process gets this number. */
export function countSegments(lines: Iterable<RawLine>): number {
  let n = 0;
  for (const raw of lines) {
    if (raw.dir === 'meta' && isRunLogMeta(raw.line) && raw.line.skaro === 'segment') n++;
  }
  return n;
}

/**
 * Rebuilds the events of an app run log: `ts` is milliseconds since `startedAt`, every segment
 * gets a new projector, Skaro events go in where they were written.
 */
export function replayRunLog(
  lines: Iterable<RawLine>,
  startedAt: number,
  createProjector: (ctx: ProjectionContext, emit: Emit) => Projector,
  attachImage: ProjectionContext['attachImage'],
): TimelineEvent[] {
  const events: TimelineEvent[] = [];
  let now = startedAt;
  const ctx: ProjectionContext = { now: () => now, attachImage };
  let segment = -1;
  const emit: Emit = (event) => events.push(segmentTurns(segment, event));
  let projector: Projector | undefined;
  for (const raw of lines) {
    now = startedAt + raw.ts;
    if (raw.dir === 'meta' && isRunLogMeta(raw.line)) {
      if (raw.line.skaro === 'segment') {
        segment++;
        projector = createProjector(ctx, emit);
      } else if (raw.line.skaro === 'event') events.push(raw.line.event);
      continue;
    }
    projector ??= createProjector(ctx, emit);
    if (raw.dir === 'in') projector.input(raw.line);
    else if (raw.dir === 'out') projector.output(raw.line);
  }
  return events;
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
