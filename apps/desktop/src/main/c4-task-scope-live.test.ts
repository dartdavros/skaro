import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { getFields, parseMarkdown, type C4Model } from '@skaro/core';
import { toTask, toSpec } from '../../../../packages/core/src/artifacts/conversion';
import { taskC4Scope } from './c4-task-scope';
import { c4CoverageProblems } from './c4-review';

const root = process.env['SKARO_C4_SCOPE_VERIFY_ROOT'];

/** Read-only regression on the owner's actual model and task; no generated project or fixtures. */
it.skipIf(!root)(
  'scopes the real design task independently of its specification deployment question',
  async () => {
    const directory = join(root!, '.skaro');
    const c4 = JSON.parse(await readFile(join(directory, 'c4/model.json'), 'utf8')) as C4Model;
    const name = (await readdir(join(directory, 'tasks'))).find((name) =>
      name.startsWith('T-166-'),
    )!;
    const file = parseMarkdown(await readFile(join(directory, 'tasks', name), 'utf8'));
    const task = toTask(getFields(file), file.body, `.skaro/tasks/${name}`, [])!;
    const binding = c4.specifications.find((item) => item.id === task.spec)!;
    const specFile = parseMarkdown(await readFile(join(directory, binding.path), 'utf8'));
    const spec = toSpec(getFields(specFile), specFile.body, `.skaro/${binding.path}`, [])!;
    const artifacts = { c4, tasks: [task], specs: [spec] };
    expect(binding.elements).toContain('deployment-host');
    const design = taskC4Scope(artifacts, task.id, ['README.md']);
    expect(design.kind).toBe('artifacts');
    expect(c4CoverageProblems(artifacts, task.id, undefined, design)).toEqual([]);
    expect(taskC4Scope(artifacts, task.id, ['README.md', 'package.json']).kind).toBe(
      'implementation',
    );
    expect(taskC4Scope(artifacts, task.id, ['compose.yaml']).kind).toBe('implementation');

    const ui = c4.elements.find((element) => element.id === 'ui-integrations')!;
    const implementation = taskC4Scope(artifacts, task.id, ui.code);
    expect(implementation.kind).toBe('implementation');
    expect(implementation.elements).toContain(ui.id);
    expect(
      c4CoverageProblems(artifacts, task.id, undefined, implementation).join('\n'),
    ).not.toContain('question-cli-supply-mode');

    const cli = c4.elements.find((element) => element.id === 'container-cli')!;
    const deployment = taskC4Scope(artifacts, task.id, cli.code);
    expect(c4CoverageProblems(artifacts, task.id, undefined, deployment).join('\n')).toContain(
      'question-cli-supply-mode',
    );
  },
);
