import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { skaroC4 } from '../../../../docs/c4/skaro-model';
import { inspectC4ReviewCandidate } from './c4-review-candidate';
import { taskC4Scope } from './c4-task-scope';
import { c4ToolFailure } from './c4-tool-diagnostic';
import { C4ValidationError } from '@skaro/core';

it('preflights real code paths on the same future model used at submission', async () => {
  const root = fileURLToPath(new URL('../../../../', import.meta.url));
  const model = structuredClone(skaroC4);
  const element = model.elements.find((e) => e.id === 'serviceclass')!;
  element.state = 'planned';
  element.code = ['apps/desktop/src/main'];
  const scope = taskC4Scope({ c4: model, tasks: [] }, '', ['apps/desktop/src/main']);
  const issues = await inspectC4ReviewCandidate(model, [element.id], root, 'HEAD', scope);
  expect(issues).toContainEqual(
    expect.objectContaining({ code: 'code_path_not_file', ids: [element.id] }),
  );
  const failure = c4ToolFailure(new C4ValidationError(issues, 'review'));
  expect(failure.isError).toBe(true);
  expect(JSON.parse(failure.text)).toEqual(failure.structuredContent);
  expect(failure.structuredContent).toMatchObject({
    diagnostic: { category: 'c4_validation', stage: 'review' },
  });
  element.code = ['apps/desktop/src/main/c4-service.ts'];
  expect(
    await inspectC4ReviewCandidate(model, [element.id], root, 'HEAD', {
      ...scope,
      elements: [element.id],
    }),
  ).toEqual([]);
  expect(element.state).toBe('planned');
  expect(
    await inspectC4ReviewCandidate(model, [], root, 'HEAD', { ...scope, kind: 'artifacts' }),
  ).toEqual([]);
});

it('does not classify an unexpected service exception as a repairable C4 rejection', () => {
  const error = new Error('SQLite is unavailable');
  expect(() => c4ToolFailure(error)).toThrow(error);
});
