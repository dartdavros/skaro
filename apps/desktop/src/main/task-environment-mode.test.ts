import { expect, it } from 'vitest';
import { inPlaceEnvironmentResult, taskRunIsolation } from './task-environment-mode';

it('keeps both kinds of started runs in their recorded isolation after defaults change', () => {
  expect(taskRunIsolation({ worktree: '/data/worktrees/project/T-026' }, 'in-place')).toBe(
    'worktree',
  );
  expect(taskRunIsolation({}, 'worktree')).toBe('in-place');
  expect(taskRunIsolation(undefined, 'worktree')).toBe('worktree');
  expect(taskRunIsolation(undefined, 'in-place')).toBe('in-place');
});

it('redirects in-place tools to shared services without claiming startup or readiness', () => {
  const result = inPlaceEnvironmentResult('/project', {});
  expect(result?.isError).not.toBe(true);
  expect(result?.structuredContent).toEqual({
    mode: 'in-place',
    cwd: '/project',
    readiness: 'not_checked',
  });
  expect(result?.text).toContain('No separate checkout is required');
  expect(result?.text).toContain('No services were started or checked');
  expect(result?.text).toContain('no configuration was changed');
  expect(result?.text).toContain('Do not retry these tools');
  expect(result?.text).toContain('documented main-copy startup procedure');
  expect(result?.text).toContain('Do not stop, restart, recreate');
});

it('leaves isolated runs on the managed environment path, including legacy shared checkouts', () => {
  for (const owner of ['T-026', 'M05']) {
    expect(
      inPlaceEnvironmentResult('/project', { worktree: `/data/worktrees/project/${owner}` }),
    ).toBeUndefined();
  }
});
