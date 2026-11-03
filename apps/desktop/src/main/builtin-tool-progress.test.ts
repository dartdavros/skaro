import { expect, it } from 'vitest';
import {
  ModelToolProgress,
  ModelNoProgressError,
} from '../../../../packages/agent-runtime/src/models/tool-progress';

// Pure decision inputs; no model/provider response, project/run or replacement service is created.
it('stops repeated identical rejected proposals regardless of argument key order', () => {
  const progress = new ModelToolProgress();
  for (let i = 0; i < 4; i++)
    progress.observe(
      'read_file',
      i % 2 ? { startLine: 0, path: 'wrong' } : { path: 'wrong', startLine: 0 },
      { error: 'Outside scope' },
    );
  expect(() => progress.requireProgress()).toThrow(ModelNoProgressError);
});

it('bounds repeated successful reads and alternating stale calls, but permits new information', () => {
  const progress = new ModelToolProgress();
  for (let i = 0; i < 2; i++)
    progress.observe('read_file', { path: `${i}.md` }, { value: { text: `${i}` } });
  for (let i = 0; i < 3; i++)
    progress.observe('read_file', { path: `${i % 2}.md` }, { value: { text: `${i % 2}` } });
  expect(() => progress.requireProgress()).toThrow(ModelNoProgressError);
  progress.reset();
  for (let i = 0; i < 20; i++)
    progress.observe('read_file', { path: 'file.md' }, { value: { text: `${i}` } });
  expect(() => progress.requireProgress()).not.toThrow();
});

it('bounds changing invalid proposals and preserves the stop across serialization', () => {
  const progress = new ModelToolProgress();
  for (let i = 0; i < 6; i++)
    progress.observe('plan_checks', { malformed: i }, { error: 'Invalid arguments' });
  const persisted = JSON.parse(JSON.stringify(progress.snapshot()));
  expect(JSON.stringify(persisted)).not.toContain('malformed');
  expect(() => new ModelToolProgress(persisted).requireProgress()).toThrow(ModelNoProgressError);
  expect(() => new ModelToolProgress({ ...persisted, failures: -1 })).toThrow();
});
