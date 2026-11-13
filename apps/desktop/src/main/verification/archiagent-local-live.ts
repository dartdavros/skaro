import assert from 'node:assert/strict';
import { BrowserWindow } from 'electron';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { git, labelsOf, COMPOSE_PROJECT } from '@skaro/core';
import type { Services } from '../app-services';
import type { LocalVersionTarget } from '../../shared/local-versions';
import { sessionHandlers } from '../session-handlers';
import { taskInputSnapshot } from '../task-preflight-inputs';
import { systemDocker } from '../task-environment-docker';
import { localDataObjects } from '../local-version-target';
import { eventually } from './resource-workflow-observation';

/** Genuine immutable installation of the authorized task commit, before any Git publication. */
export async function verifyArchiagentLocal(s: Services, project: string, directory: string) {
  const prepared = JSON.parse(await readFile(join(directory, 'compose-review-proof.json'), 'utf8'));
  assert(prepared.passed);
  const technical = prepared.technical;
  const context = s.projects.get(project),
    handlers = sessionHandlers(s),
    task = String(technical.task);
  const run = s.db.latestRun(project, task)!;
  assert.equal(run.id, technical.run.id);
  assert(run.worktree);
  assert.equal(await context.git.head(), technical.base);
  assert.equal(await context.git.head('HEAD', run.worktree), technical.committed);
  assert.equal((await git(run.worktree, ['status', '--porcelain'])).stdout.trim(), '');
  const inputs = await taskInputSnapshot(s.db, context, await context.load(), task);
  const operation = await handlers['local.prepareCandidate'](
    project,
    task,
    technical.committed,
    inputs.version,
  );
  const settled = await eventually(
    () => s.runs['engine'].integrations.store.find(project, operation.id),
    (v) => !!v && !v.executor && ['ready', 'failed', 'waiting', 'paused'].includes(v.state),
    'real local candidate check and readiness',
    360000,
  );
  assert.equal(settled?.state, 'ready', settled?.error ?? 'Local candidate is not ready');
  const manifest = await s.runs.localCandidates.verify(project, operation.id);
  assert.equal(manifest.head, technical.committed);
  const before = (await systemDocker.inspect()).filter(
    (c) => labelsOf(c)[COMPOSE_PROJECT] === 'cat-pilot-dev',
  );
  assert(before.length > 0 && before.every((c) => !c.State?.Running));
  const existing = s.db.collections
    .all<LocalVersionTarget>(`coordination.local-targets.${project}`)
    .find((t) => t.id === 'cat-pilot-dev');
  assert(existing && existing.dataVersion === 'no-persistent-data');
  const {
    projectId: _project,
    revision: _revision,
    configuration: _configuration,
    ...registration
  } = existing;
  const target = await handlers['local.register'](project, registration);
  const receipt = await handlers['local.install'](project, target.id, manifest.id, target.revision);
  await writeFile(
    join(directory, 'local-install-checkpoint.json'),
    JSON.stringify({ task, manifest, receipt, beforeData: localDataObjects(before) }, null, 2),
  );
  assert.equal(receipt.state, 'verified');
  assert.notEqual(receipt.release, run.worktree);
  assert.equal(
    await context.git.head(),
    technical.base,
    'Local verification must precede Git acceptance',
  );
  const response = await fetch(target.ready, { signal: AbortSignal.timeout(10000) });
  assert(response.ok);
  const html = await response.text();
  assert.equal(html, await readFile(join(run.worktree, 'index.html'), 'utf8'));
  const script = await fetch(new URL('js/motion-controls.js', target.ready), {
    signal: AbortSignal.timeout(10000),
  });
  assert(script.ok);
  assert.equal(
    createHash('sha256')
      .update(Buffer.from(await script.arrayBuffer()))
      .digest('hex'),
    '079aa7a80f5e35b43a79c74d8d999ce68896ec188e4dc1e571081367997ac5bc',
  );
  const after = (await systemDocker.inspect()).filter(
    (c) => labelsOf(c)[COMPOSE_PROJECT] === 'cat-pilot-dev',
  );
  assert(after.every((c) => c.State?.Running));
  assert.equal(localDataObjects(after), localDataObjects(before));
  assert(s.resources.holdings(project, 'local-environment:cat-pilot-dev').length > 0);
  const window = new BrowserWindow({
    show: false,
    width: 1280,
    height: 900,
    webPreferences: { sandbox: true, backgroundThrottling: false },
  });
  try {
    const errors: string[] = [];
    window.webContents.on('console-message', (event) => {
      if (event.level === 'error') errors.push(event.message);
    });
    await window.loadURL(target.ready);
    const state = await window.webContents.executeJavaScript(
      `({title:document.title,scripts:[...document.scripts].map(s=>s.src),broken:[...document.images].filter(i=>!i.complete||!i.naturalWidth).length})`,
    );
    assert.equal(state.broken, 0);
    assert(state.scripts.some((src: string) => src.endsWith('/js/motion-controls.js')));
    assert.deepEqual(errors, []);
    await writeFile(
      join(directory, 'local-before-git-acceptance.png'),
      (await window.webContents.capturePage()).toPNG(),
    );
    return {
      task,
      manifest,
      receipt,
      browser: state,
      baseUnchanged: technical.base,
      sourceMatchesVerifiedTask: true,
      dataIdentityPreserved: true,
      permanentHoldings: s.resources
        .holdings(project, 'local-environment:cat-pilot-dev')
        .map((h) => h.lease),
      beforeObjects: before.map((c) => c.Id),
      installedObjects: after.map((c) => c.Id),
    };
  } finally {
    window.destroy();
  }
}
