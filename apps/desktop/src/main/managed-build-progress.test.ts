import { expect, it } from 'vitest';
import { managedBuildProgress } from './managed-build-progress';

// Pure upstream protocol metadata; not a fake Docker client or live solve evidence.
const digest = `sha256:${'a'.repeat(64)}`;
const completed = '2026-11-13T02:00:00Z';
it('reads completed RUN vertices from chunked SolveStatus JSON and preserves actual cached bool', () => {
  for (const cached of [undefined, true]) {
    const progress = managedBuildProgress(['compile']);
    const text = JSON.stringify({
      vertexes: [{ digest, name: '[2/3] RUN compile', completed, cached }],
    });
    progress.accept(Buffer.from(text.slice(0, 23)));
    progress.accept(Buffer.from(text.slice(23) + '\n'));
    expect(progress.finish()).toEqual([
      { instruction: 1, vertex: digest, observed: true, cached: cached === true },
    ]);
  }
});
it('does not infer receipts from logs, unfinished, failed, ambiguous or malformed vertices', () => {
  for (const change of [
    { completed: undefined },
    { completed: true },
    { error: 'failure' },
    { digest: 'other' },
    { cached: 'true' },
    { name: 'RUN other' },
  ]) {
    const progress = managedBuildProgress(['compile']);
    progress.accept(
      Buffer.from(
        JSON.stringify({
          vertexes: [{ digest, name: 'RUN compile', completed, ...change }],
          logs: [{ data: 'RUN compile' }],
        }),
      ),
    );
    expect(progress.finish()[0]!.observed).toBe(false);
  }
  const ambiguous = managedBuildProgress(['compile', 'compile']);
  ambiguous.accept(
    Buffer.from(JSON.stringify({ vertexes: [{ digest, name: 'RUN compile', completed }] })),
  );
  expect(ambiguous.finish().every((step) => !step.observed)).toBe(true);
});
