import { expect, it } from 'vitest';
import { emptyTimeline } from '@skaro/timeline';
import { IncidentWork } from './incident-work';
import { taskTimelineRuntime } from './task-runtime-state';

it('publishes actual recovery work immediately and releases its running status exactly once', () => {
  const states: string[] = [];
  const work = new IncidentWork((project, id) => {
    states.push(
      taskTimelineRuntime(emptyTimeline(), work.running(project, id) ? 'running' : 'queued'),
    );
  });
  expect(work.running('project', 'incident')).toBe(false);
  const finish = work.start({ projectId: 'project', id: 'incident' });
  expect(states).toEqual(['running']);
  expect(work.running('other-project', 'incident')).toBe(false);
  expect(work.running('project', 'other-incident')).toBe(false);
  finish();
  finish();
  expect(states).toEqual(['running', 'queued']);
  expect(work.running('project', 'incident')).toBe(false);
});
