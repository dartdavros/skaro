import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ownsResourceCapacity } from '@skaro/core';
import type { Services } from '../app-services';
import { sessionHandlers } from '../session-handlers';
import { TaskExecution } from '../task-execution';
import { taskC4Protocol } from '../c4-protocol';
import { inspectArchiagent } from './archiagent-inspect-live';

/** Aggregate only completed real proofs; an observation never promotes a partial audit to full. */
export async function finishArchiagent(
  s: Services,
  project: string,
  data: string,
  directory: string,
) {
  const names = [
    'preflight.json',
    'storage-readonly-verification.json',
    'activation-proof.json',
    'quota-proof.json',
    'shared-proof.json',
    'browser-shared-proof.json',
    'chat-causal-proof.json',
    'inputs-observe-proof.json',
    'budget-two-projects-proof.json',
    'resources-proof.json',
    'c4-observe-proof.json',
    'browser-material-reject-proof.json',
    'technical-review-proof.json',
    'compose-review-proof.json',
    'local-before-acceptance-proof.json',
    'technical-publish-proof.json',
  ];
  const rows = [],
    proofs = new Map<string, string>();
  for (const name of names) {
    const bytes = await readFile(join(directory, name));
    const p = JSON.parse(bytes.toString('utf8'));
    assert.equal(p.passed, true, `Unclosed genuine proof: ${name}`);
    assert(!p.projectId || p.projectId === project);
    proofs.set(name, bytes.toString('utf8'));
    rows.push({
      file: name,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      passed: true,
    });
  }
  const browser = JSON.parse(proofs.get('browser-shared-proof.json')!),
    chat = JSON.parse(proofs.get('chat-causal-proof.json')!).chat,
    pub = JSON.parse(proofs.get('technical-publish-proof.json')!).publication;
  assert(
    browser.result.oneEffect && browser.normalExit && browser.realHistoryPages.after.min === 0,
  );
  assert(chat.oneEffect && chat.automaticTaskContinuation && chat.ownerForwardedMessages === 0);
  assert(JSON.parse(proofs.get('budget-two-projects-proof.json')!).policyRestored);
  assert(JSON.parse(proofs.get('browser-material-reject-proof.json')!).result.stoppedTaskPreserved);
  assert(
    pub.cleanup.taskCheckoutRemoved &&
      pub.cleanup.candidateCheckoutRemoved &&
      pub.cleanup.permanentStillRunning &&
      pub.cleanup.dataPreserved,
  );
  assert(
    pub.localRollback.state === 'rolled_back' && pub.replayIdempotent && pub.mergeRecordedOnce,
  );
  const artifacts = await s.projects.get(project).load();
  assert.equal(artifacts.c4?.revision, 5);
  assert.equal(artifacts.c4.questions.length, 9);
  const inspection = await inspectArchiagent(s, project, data);
  assert(
    inspection.activation.compatible &&
      inspection.activation.dispatch.enabled &&
      inspection.activation.protocol === 'impact-v1',
  );
  const stopped = [];
  for (const task of ['T-010', 'T-011', 'T-014', 'T-015', pub.task]) {
    const run = s.db.latestRun(project, task)!;
    assert(run);
    assert.equal(new TaskExecution(s.db, run.id).read().enabled, false);
    stopped.push({ task, run: run.id, enabled: false });
  }
  const bindings = s.db.listRuns(project, undefined, { includeRetired: true }).map((run) => ({
    id: run.id,
    task: run.taskId,
    protocol: taskC4Protocol(s.db, project, run.id),
  }));
  assert.equal(bindings.filter((b) => b.protocol === 'package-v1').length, 22);
  assert.equal(bindings.filter((b) => b.protocol === 'impact-v1').length, 5);
  assert.equal(
    s.db.admission.all().filter((l) => l.projectId === project && ownsResourceCapacity(l)).length,
    0,
    'Do not hide a retained external holding',
  );
  assert(
    !(await sessionHandlers(s)['decisions.list'](project)).some((d) =>
      ['T-012', 'T-013', 'T-015', pub.task].includes(d.origin.id),
    ),
  );
  return {
    proofs: rows,
    inspection,
    stopped,
    bindings,
    mandatoryScenariosPassed: true,
    scope: {
      platform: process.platform,
      adapter: 'real Codex',
      runtimeProject: 'Cat-pilot',
      secondProject: 'ChatRouter host-only explicit exception',
    },
    limits: {
      fullAudit: 'A real partial audit is preserved; full architectural coverage is not claimed',
      quota: 'Configured account cap; no provider-wide outage was fabricated',
      docker: 'Real unavailable CLI connection; no daemon-wide crash was fabricated',
      disk: 'Logical source bytes/actual absence and host free space are distinct; no causal host-disk speedup claim',
      platforms: 'macOS/Linux and other native adapters were not live-tested here',
    },
  };
}
