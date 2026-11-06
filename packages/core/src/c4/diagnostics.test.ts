import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { expect, it } from 'vitest';
import { skaroC4 } from '../../../../docs/c4/skaro-model.ts';
import { inspectC4Model, validateC4Model } from './validate.ts';
import { realizeC4 } from './state.ts';
import { inspectC4Code } from './project.ts';
import { C4ValidationError } from './diagnostics.ts';

// Pure state projections of the real documented architecture; no files or services are created.
function plannedArchitecture() {
  const model = structuredClone(skaroC4);
  for (const entry of [...model.elements, ...model.relationships, ...model.views])
    entry.state = 'planned';
  for (const entry of model.exclusions) entry.state = 'planned';
  return model;
}

it('explains missing parents without publishing them or changing the accepted model', () => {
  const model = plannedArchitecture();
  const before = structuredClone(model);
  const issues = inspectC4Model(realizeC4(model, ['serviceclass']));
  expect(issues).toContainEqual(
    expect.objectContaining({
      code: 'planned_parent',
      ids: ['serviceclass', 'c4service'],
      nextStep: expect.stringContaining('only if fully implemented and verified'),
    }),
  );
  expect(model).toEqual(before);
});

it('explains partial publication and accepts a narrow planned view without realizing future code', () => {
  const model = plannedArchitecture();
  expect(validateC4Model(model)).toEqual([]);
  const ids = [...model.elements, ...model.relationships]
    .map((entry) => entry.id)
    .filter((id) => id !== 'codereview');
  expect(inspectC4Model(realizeC4(model, ids))).toContainEqual(
    expect.objectContaining({
      code: 'missing_current_view',
      ids: ['c4service'],
      nextStep: expect.stringContaining('separate planned view'),
    }),
  );
  const view = structuredClone(model.views.find((v) => v.id === 'servicecode')!);
  view.id += '-implemented';
  view.elements = ['serviceclass'];
  model.views.push(view);
  expect(validateC4Model(model)).toEqual([]);
  const candidate = realizeC4(model, ids);
  expect(validateC4Model(candidate)).toEqual([]);
  expect(candidate.views.find((v) => v.id === view.id)?.state).toBe('current');
  expect(candidate.views.find((v) => v.id === 'servicecode')?.state).toBe('planned');
  expect(candidate.elements.find((e) => e.id === 'codereview')?.state).toBe('planned');
  view.state = 'current';
  expect(inspectC4Model(model)).toContainEqual(
    expect.objectContaining({ code: 'planned_view_member', ids: [view.id, 'serviceclass'] }),
  );
});

it('identifies a real directory code binding and preserves filesystem failures as operational errors', async () => {
  const root = fileURLToPath(new URL('../../../../', import.meta.url));
  const model = structuredClone(skaroC4);
  const element = model.elements.find((e) => e.id === 'serviceclass')!;
  element.code = [dirname(element.code[0]!).replaceAll('\\', '/')];
  expect(await inspectC4Code(root, model)).toContainEqual(
    expect.objectContaining({
      code: 'code_path_not_file',
      ids: ['serviceclass'],
      path: element.code[0],
      nextStep: expect.stringContaining('concrete existing project files'),
    }),
  );
  try {
    await inspectC4Code(root + '/nonexistent-checkout', model);
    expect.fail('A missing checkout must not be classified as invalid model data');
  } catch (error) {
    expect(error).not.toBeInstanceOf(C4ValidationError);
    expect(error).toMatchObject({ code: 'ENOENT' });
  }
});
