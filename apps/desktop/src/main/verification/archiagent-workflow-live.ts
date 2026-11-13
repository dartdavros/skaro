import { app } from 'electron';
import assert from 'node:assert/strict';
import { copyFile, readFile, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { catPilotState } from './cat-pilot-state';
import { createServices, type Services } from '../app-services';
import { archiagentBaseline, assertArchiagentPreserved } from './archiagent-baseline';
import { inspectArchiagent } from './archiagent-inspect-live';
import { verifyArchiagentActivation } from './archiagent-activation-live';
import { verifyArchiagentQuota } from './archiagent-quota-live';
import { coordinatorShared } from './coordinator-shared-live';
import { inspectArchiagentChat, verifyArchiagentChat } from './archiagent-chat-live';
import { verifyArchiagentResources } from './archiagent-resources-live';
import { verifyArchiagentInputs } from './archiagent-inputs-live';
import { observeArchiagentC4, verifyArchiagentC4 } from './archiagent-c4-live';
import { recheckArchiagentInputs } from './archiagent-input-recheck';
import { observeArchiagentInputs } from './archiagent-input-observe';
import { prepareArchiagentMaterial } from './archiagent-material-live';
import { observeArchiagentFinal } from './archiagent-final-observe';
import { prepareArchiagentTechnical } from './archiagent-tech-prepare';
import { verifyArchiagentLocal } from './archiagent-local-live';
import { reviewArchiagentTechnical } from './archiagent-tech-review';
import { reviewArchiagentCompose } from './archiagent-compose-review';
import { publishArchiagentTechnical } from './archiagent-publish-live';
import { verifyArchiagentChatCausal } from './archiagent-chat-causal';
import { finishArchiagent } from './archiagent-finish-live';
import { restoreArchiagentLocal } from './archiagent-restore-local';
import { closeCoordinatorVerification } from './coordinator-live-close';

app.setName('Skaro');
if (!app.requestSingleInstanceLock()) app.exit(1);
app.on('window-all-closed', () => undefined);
void app.whenReady().then(async () => {
  const data = app.getPath('userData'),
    state = catPilotState(data),
    project = state.db.shell.projectScope!;
  const directory = resolve(process.env.SKARO_AG1_CASE ?? '');
  assert(directory.startsWith(resolve(data, 'verification') + sep));
  const phase = process.env.SKARO_AG1_PHASE ?? 'inspect';
  const proof: Record<string, unknown> = {
    projectId: project,
    directory,
    phase,
    startedAt: new Date().toISOString(),
  };
  let s: Services | undefined,
    code = 1;
  let publication: Awaited<ReturnType<typeof publishArchiagentTechnical>> | undefined;
  try {
    const preflight = JSON.parse(await readFile(join(directory, 'preflight.json'), 'utf8'));
    assert(
      preflight.passed &&
        preflight.projectId === project &&
        preflight.backups.every(
          (b: { integrity: string; synced: boolean }) => b.integrity === 'ok' && b.synced,
        ),
    );
    proof.preflight = join(directory, 'preflight.json');
    const start = performance.now();
    s = await createServices(state, data, () => undefined, {
      builtinEntries: resolve('apps/desktop/out/main'),
      silentVerification: true,
    });
    proof.serviceStartupMs = performance.now() - start;
    const before = await archiagentBaseline(s, project, data);
    if (phase === 'inspect') proof.inspection = await inspectArchiagent(s, project, data);
    else if (phase === 'finish')
      proof.acceptance = await finishArchiagent(s, project, data, directory);
    else if (phase === 'final-observe')
      proof.final = await observeArchiagentFinal(s, project, data);
    else if (phase === 'activation')
      proof.activation = await verifyArchiagentActivation(s, project, data);
    else if (phase === 'quota') proof.quota = await verifyArchiagentQuota(s, project);
    else if (phase === 'shared') await coordinatorShared(s, project, proof, 'AG-1');
    else if (phase === 'chat') proof.chat = await verifyArchiagentChat(s, project);
    else if (phase === 'chat-inspect')
      proof.chatDiagnostic = await inspectArchiagentChat(s, project);
    else if (phase === 'chat-causal') proof.chat = await verifyArchiagentChatCausal(s, project);
    else if (phase === 'resources') proof.resources = await verifyArchiagentResources(s, project);
    else if (phase === 'inputs') proof.inputs = await verifyArchiagentInputs(s, project);
    else if (phase === 'c4') proof.c4 = await verifyArchiagentC4(s, project, directory);
    else if (phase === 'c4-observe') proof.c4 = await observeArchiagentC4(s, project, directory);
    else if (phase === 'material-prepare')
      proof.material = await prepareArchiagentMaterial(s, project, directory);
    else if (phase === 'technical-prepare')
      proof.technical = await prepareArchiagentTechnical(s, project, directory);
    else if (phase === 'technical-review')
      proof.technical = await reviewArchiagentTechnical(s, project, directory);
    else if (phase === 'compose-review')
      proof.technical = await reviewArchiagentCompose(s, project, directory);
    else if (phase === 'local-before-acceptance')
      proof.local = await verifyArchiagentLocal(s, project, directory);
    else if (phase === 'restore-local')
      proof.restoration = await restoreArchiagentLocal(s, project, directory);
    else if (phase === 'technical-publish')
      proof.publication = publication = await publishArchiagentTechnical(s, project, directory);
    else if (phase === 'inputs-recheck') proof.inputs = await recheckArchiagentInputs(s, project);
    else if (phase === 'inputs-observe')
      proof.inputs = await observeArchiagentInputs(
        s,
        project,
        process.env.SKARO_AG1_COMMAND ?? '',
        process.env.SKARO_AG1_PRIOR_COMMAND ?? '',
        directory,
      );
    else throw new Error(`Unsupported AG-1 phase: ${phase}`);
    proof.preservation = await assertArchiagentPreserved(
      before,
      s,
      project,
      data,
      ['technical-review', 'compose-review'].includes(phase)
        ? [String((proof.technical as { task: string }).task)]
        : publication
          ? [publication.task]
          : [],
      publication?.source,
    );
    proof.elapsedMs = performance.now() - start;
    proof.bundleHash = createHash('sha256')
      .update(await readFile(process.argv[1]!))
      .digest('hex');
    proof.passed = true;
    code = 0;
  } catch (error) {
    proof.error = error instanceof Error ? error.stack : String(error);
  } finally {
    if (s)
      try {
        await s.c4Audits.close();
        await closeCoordinatorVerification(s);
      } catch (error) {
        proof.cleanupError = String(error);
        code = 1;
      }
    const output = join(directory, `${phase}-proof.json`);
    try {
      await copyFile(output, join(directory, `${phase}-previous-${randomUUID()}.json`));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        proof.archiveError = String(error);
        code = 1;
      }
    }
    proof.passed = proof.passed === true && code === 0;
    await writeFile(output, JSON.stringify(proof, null, 2));
    state.db.close();
    process.send?.({ phase, directory, passed: proof.passed, code, error: proof.error });
    app.exit(code);
  }
});
