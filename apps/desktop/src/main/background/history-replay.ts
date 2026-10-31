import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { projectorFor } from '@skaro/agents';
import {
  isRunLogMeta,
  segmentTurns,
  type Projector,
  type TimelineEvent,
  type RawLine,
  type ProjectionContext,
} from '@skaro/timeline';

/** Stream the recorded native protocol through the same projectors as a live agent. */
export async function replayHistory(
  path: string,
  startedAt: number,
  agent: string,
  attachments: Pick<ProjectionContext, 'attachImage'>,
  saved: (event: TimelineEvent) => void,
): Promise<number> {
  let now = startedAt;
  let segment = -1;
  let segments = 0;
  const context = { now: () => now, attachImage: attachments.attachImage };
  const emit = (event: TimelineEvent) => saved(segmentTurns(segment, event));

  let projector: Projector | undefined;
  const input = createReadStream(path, { encoding: 'utf8' });
  const lines = createInterface({ input, crlfDelay: Infinity });
  try {
    for await (const text of lines) {
      if (!text.trim()) continue;
      let raw: RawLine;
      try {
        raw = JSON.parse(text) as RawLine;
      } catch {
        continue;
      }
      now = startedAt + raw.ts;
      if (raw.dir === 'meta' && isRunLogMeta(raw.line)) {
        if (raw.line.skaro === 'segment') {
          segment++;
          segments++;
          projector = (await projectorFor(raw.line.agent, raw.line.adapterVersion))(context, emit);
        } else if (raw.line.skaro === 'event') {
          // Saved events already contain scoped turn ids.
          saved(raw.line.event);
        }
      } else {
        projector ??= (await projectorFor(agent))(context, emit);
        if (raw.dir === 'in') projector.input(raw.line);
        else if (raw.dir === 'out') projector.output(raw.line);
      }
    }
  } finally {
    lines.close();
    input.destroy();
  }
  return segments;
}
