import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Services } from '../app-services';
import type { LocalVersionReceipt } from '../../shared/local-versions';
import { sessionHandlers } from '../session-handlers';

/** Return only this acceptance's local installation/configuration to its verified pre-test state. */
export async function restoreArchiagentLocal(s: Services, project: string, directory: string) {
  const installed = JSON.parse(
    await readFile(join(directory, 'local-before-acceptance-proof.json'), 'utf8'),
  );
  const started = JSON.parse(
    await readFile(join(directory, 'technical-task-started.json'), 'utf8'),
  );
  assert(installed.passed && installed.local.task === started.task);
  const current = s.db.collections.get<LocalVersionReceipt>(
    `coordination.installations.${project}`,
    installed.local.receipt.id,
  );
  assert(
    current &&
      current.targetId === 'cat-pilot-dev' &&
      current.release === installed.local.receipt.release,
  );
  const receipt = await sessionHandlers(s)['local.rollback'](project, current.id);
  assert.equal(receipt.state, 'rolled_back');
  const context = s.projects.get(project),
    path = join(context.root, '.skaro/config.yaml');
  const before = String(started.configBefore),
    expected = before.replace(
      'node --check js/pause-controls.js',
      'node --check js/motion-controls.js',
    );
  const observed = await readFile(path, 'utf8');
  assert(
    observed === before || observed === expected,
    'Do not overwrite concurrent owner configuration',
  );
  if (observed !== before) await writeFile(path, before);
  context.invalidate();
  assert.equal(await context.git.head(), started.base, 'No failed publication may move the base');
  assert.equal((await context.load()).c4?.revision, 4);
  assert.equal(s.resources.holdings(project, 'local-environment:cat-pilot-dev').length, 0);
  return {
    task: started.task,
    receipt,
    configuredCheckRestored: true,
    baseUnchanged: started.base,
    modelRevision: 4,
    remainingGate:
      'The existing compose.yaml is not versioned; no new source is admitted without owner permission',
  };
}
