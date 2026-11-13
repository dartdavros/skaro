import assert from 'node:assert/strict';
import { BrowserWindow } from 'electron';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { git } from '@skaro/core';
import type { Services } from '../app-services';
import { sessionHandlers } from '../session-handlers';
import { taskInputSnapshot } from '../task-preflight-inputs';
import { verifyPrerequisites } from '../task-preflight-inputs';
import { parseProjectWorkflow, labelsOf, COMPOSE_PROJECT } from '@skaro/core';
import { systemDocker } from '../task-environment-docker';
import { eventually } from './resource-workflow-observation';
import type { LocalVersionReceipt } from '../../shared/local-versions';

export async function verifyCoordinatorLocal(
  s: Services,
  projectId: string,
  taskId: string,
  proof: Record<string, unknown>,
  directory: string,
) {
  const context = s.projects.get(projectId),
    handlers = sessionHandlers(s);
  const artifacts = await context.store.load();
  const dev = (await systemDocker.inspect()).filter(
    (c) => labelsOf(c)[COMPOSE_PROJECT] === 'cat-pilot-dev',
  );
  assert(
    dev.length && dev.every((c) => !c.State?.Running),
    'The real dev contour must initially be stopped for this negative readiness check',
  );
  await assert.rejects(
    verifyPrerequisites(
      {
        ...artifacts,
        config: {
          ...artifacts.config,
          workflow: parseProjectWorkflow({
            [taskId]: [
              {
                kind: 'service',
                id: 'permanent-dev',
                phase: 'prerequisite',
                url: 'http://localhost:18941',
              },
            ],
          }),
        },
      },
      taskId,
      context.root,
    ),
  );
  proof.unreadyServiceRejected = true;
  const snapshot = await taskInputSnapshot(s.db, context, artifacts, taskId);
  const run = s.db.listRuns(projectId, taskId)[0]!;
  assert(run.worktree);
  const head = await context.git.head('HEAD', run.worktree);
  const base = await context.git.head(artifacts.config.baseBranch);
  const source = join(run.worktree, 'index.html');
  const original = await readFile(source, 'utf8');
  const edited =
    original + '\n<!-- AC-2: сохранность незакоммиченной работы при подготовке кандидата -->\n';
  await writeFile(source, edited);
  try {
    await assert.rejects(
      s.runs.localCandidates.prepare(projectId, taskId, head, snapshot.version),
      /Commit task changes/,
    );
    assert.equal(await readFile(source, 'utf8'), edited);
  } finally {
    assert.equal(await readFile(source, 'utf8'), edited);
    await writeFile(source, original);
  }
  const op = await handlers['local.prepareCandidate'](projectId, taskId, head, snapshot.version);
  await eventually(
    () => s.runs['engine'].integrations.store.find(projectId, op.id),
    (v) => !!v && !v.executor && ['ready', 'failed', 'waiting', 'paused'].includes(v.state),
    'real local candidate checks and services',
    240000,
  );
  const manifest = await s.runs.localCandidates.verify(projectId, op.id);
  assert.equal(await context.git.head(artifacts.config.baseBranch), base);
  const resource = s.db.resources
    .list(projectId)
    .find((r) => r.purpose === 'project-dev' && r.identity.composeProject === 'cat-pilot-dev');
  assert(resource, 'Use the existing registered permanent Cat-pilot contour');
  const target = await handlers['local.register'](projectId, {
    id: 'cat-pilot-dev',
    resourceId: resource.id,
    composeFile: join(context.root, 'compose.yaml'),
    codeVariable: 'CATPILOT_ROOT',
    variables: { CATPILOT_ROOT: context.root, UI_PORT: '18941' },
    ready: 'http://localhost:18941',
    dataVersion: 'no-persistent-data',
  });
  let receipt: LocalVersionReceipt | undefined;
  try {
    receipt = await handlers['local.install'](projectId, target.id, manifest.id, target.revision);
    assert.equal(receipt.state, 'verified');
    assert.notEqual(receipt.release, run.worktree);
    assert.equal((await git(receipt.release, ['rev-parse', 'HEAD'])).stdout.trim(), manifest.head);
    assert.equal(await (await fetch(target.ready)).text(), original);
    assert.equal(await context.git.head(artifacts.config.baseBranch), base);
    const browser = new BrowserWindow({
      show: false,
      width: 1280,
      height: 900,
      webPreferences: { sandbox: true },
    });
    try {
      await browser.loadURL(target.ready);
      const screenshot = join(directory, 'installed-cat-pilot.png');
      await writeFile(screenshot, (await browser.webContents.capturePage()).toPNG());
      proof.browser = { url: target.ready, title: browser.getTitle(), screenshot };
    } finally {
      browser.destroy();
    }
    proof.local = { manifest, receipt, baseUnchanged: base, dirtyWorkPreserved: true };
  } finally {
    receipt ??= s.db.collections
      .all<LocalVersionReceipt>(`coordination.installations.${projectId}`)
      .filter((r) => r.targetId === target.id)
      .at(-1);
    if (receipt && receipt.state !== 'rolled_back') {
      const rollback = await handlers['local.rollback'](projectId, receipt.id);
      assert.equal(rollback.state, 'rolled_back');
      proof.rollback = rollback;
    }
  }
}
