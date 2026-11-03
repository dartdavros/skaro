import assert from 'node:assert/strict';
import { writeFile, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import type { Services } from '../app-services';
import { serializeTaskMutation } from '../project-task-mutations';
import { updateSubject } from '../task-subject';
import { liveBudgetLedger } from '../credentials/live-budget-ledger';
import { requireTaskWorkflowBudget } from './task-workflow-budget';
import { verifyTaskWorkflowPacket, type TaskWorkflowPacket } from './task-workflow-packet';
import { workflowOwnerInput, type workflowModels } from './task-workflow-models';
import {
  waitTaskStop,
  taskAdmissionStore,
  requireTaskProcessExit,
  observeTaskJournal,
} from './task-stop-observation';
import { setTimeout as delay } from 'node:timers/promises';
import { readLocalPacket } from './local-packet';
import { readRuntimeJournal } from '@skaro/agent-runtime';
import { awaitWorkflowApproval } from './task-workflow-owner-control';

export interface WorkflowLiveOptions {
  proofPath?: string;
  review?: boolean;
  rebind?: boolean;
  strict?: boolean;
}

/** Owner authorized the plan-first transition on 03.11.2026; no permission-mode widening. */
export async function verifyTaskWorkflowLive(
  services: Services,
  data: string,
  directory: string,
  packet: TaskWorkflowPacket,
  models: ReturnType<typeof workflowModels>,
  options: WorkflowLiveOptions = {},
) {
  const { proofPath: retryProof, review = false, rebind = false, strict = false } = options;
  const retry = retryProof
    ? ((await readLocalPacket(data, retryProof)) as {
        runId: string;
        cleanupConfirmed: boolean;
        budget: { requests: number; committedNanoUsd: number };
        before: { payloadHash: string };
        primary: { journalPath: string; sessionId: string }[];
      })
    : undefined;
  if (retry) {
    assert(
      retry.cleanupConfirmed &&
        retry.before.payloadHash ===
          '600af359e54afa9328a70a418205f04784220a016778f298bb1bbcc3bc969cb1',
    );
    assert(retry.primary.length <= 1);
    if (review || rebind) assert((await lstat(retry.primary[0]!.journalPath)).isFile());
    else if (retry.primary[0])
      await assert.rejects(lstat(retry.primary[0].journalPath), { code: 'ENOENT' });
    assert.deepEqual(
      await liveBudgetLedger(join(data, 'verification/openrouter-ba4')),
      retry.budget,
    );
  }
  const before = await verifyTaskWorkflowPacket(
    services,
    data,
    packet,
    retry && {
      runId: retry.runId,
      ...(review || rebind ? { sessionId: retry.primary[0]!.sessionId } : {}),
    },
  );
  const projectId = packet.project.id,
    taskId = 'T-006';
  const context = services.projects.get(projectId);
  // The reviewed plan implements precisely the existing storyboard and the ten task criteria.
  const storyboard = packet.wireComposition.sources.find(
    (source) => source.path === '.skaro/docs/storyboard.md',
  );
  assert(storyboard && storyboard.text.includes('10s'));
  assert.equal(packet.wireComposition.tasks[0]!.criteria.length, 10);
  if (!retry || rebind)
    await services.runs.handoffBuiltin({
      projectId,
      taskId,
      settings: { ...before.settings, planFirst: false },
      signal: new AbortController().signal,
    });
  const run = services.db.listRuns(projectId, taskId)[0]!;
  if (!retry || rebind) assert.equal(run.previousRunId, before.runId);
  assert.equal(run.worktree, undefined);
  await models.bind(run.id);
  let outcome: unknown;
  let cleanupConfirmed = false;
  try {
    await serializeTaskMutation(context, async () => {
      await updateSubject(context, taskId, { status: 'in_progress' });
      context.invalidate();
    });
    services.runs.projectChanged(projectId);
    const priorInputs = review
      ? (
          await readRuntimeJournal(retry!.primary[0]!.journalPath, retry!.primary[0]!.sessionId)
        ).records
          .flatMap((record) => record.facts)
          .filter((fact) => fact.type === 'input').length
      : 0;
    const ownerInput = workflowOwnerInput(packet, priorInputs, strict ? run.id : undefined);
    await services.runs.send(projectId, taskId, ownerInput);
    const prepared = await waitTaskStop('workflow native host', () => models.generations[0]);
    await waitTaskStop('workflow initial primary journal', async () => {
      try {
        return await observeTaskJournal(prepared.journalPath, prepared.sessionId);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
        throw error;
      }
    });
    const deadline = Date.now() + (strict ? 1200000 : 300000);
    while (Date.now() < deadline) {
      const journal = await observeTaskJournal(prepared.journalPath, prepared.sessionId);
      if (!journal) {
        await delay(300);
        continue;
      }
      const interactions = Object.values(journal.state.interactions);
      if (interactions.length) {
        if (strict && (await awaitWorkflowApproval(services, projectId, run.id, interactions[0]!)))
          continue;
        outcome = { kind: 'owner-decision-required', interactions };
        process.send?.({ type: 'workflow-interactions', runId: run.id, interactions });
        break;
      }
      const ack = journal.records.find((record) => record.id === `cmd:${ownerInput.commandId}`);
      const modelId = (ack?.result.value as { modelTurnId?: string } | undefined)?.modelTurnId;
      if (!ack) {
        await delay(300);
        continue;
      }
      if (ack.result.error) {
        outcome = { kind: 'input-rejected', error: ack.result.error };
        break;
      }
      const terminal = modelId && journal.records.find((record) => record.id === `cmd:${modelId}`);
      if (terminal) {
        const response = terminal.result.value as
          | { message?: { content?: string }; finishReason?: string; provenance?: unknown }
          | undefined;
        outcome = {
          kind: 'model-terminal',
          error: terminal.result.error,
          response: response && {
            text: response.message?.content,
            finishReason: response.finishReason,
            provenance: response.provenance,
          },
        };
        break;
      }
      if (journal.state.stopped || journal.state.closed) {
        outcome = { kind: 'runtime-stopped' };
        break;
      }
      await delay(300);
    }
    outcome ??= { kind: 'observation-deadline' };
  } catch (error) {
    outcome = {
      kind: 'driver-failure',
      name: error instanceof Error ? error.name : 'Error',
      reason:
        error instanceof Error
          ? error.message
              .split('\n')[0]!
              .slice(0, 160)
              .replace(/[a-zA-Z0-9_-]{32,}/g, '[reference]')
          : 'Unknown',
    };
    throw error;
  } finally {
    try {
      await services.runs.interrupt(projectId, taskId);
      const admission = taskAdmissionStore(services, projectId, run.id).read();
      if (admission)
        await requireTaskProcessExit(
          taskAdmissionStore(services, projectId, run.id),
          admission.admission.id,
          false,
        );
      cleanupConfirmed = true;
    } finally {
      const budget = await liveBudgetLedger(join(data, 'verification/openrouter-ba4'));
      await writeFile(
        join(directory, 'task-workflow-attempt.json'),
        JSON.stringify(
          {
            before,
            runId: run.id,
            outcome,
            cleanupConfirmed,
            budget,
            fullyAccepted: false,
            settingsTransition: {
              fromPlanFirst: before.settings.planFirst,
              toPlanFirst: false,
              permissionMode: 'ask',
            },
            primary: models.generations.map((item) => ({
              sessionId: item.sessionId,
              journalPath: item.journalPath,
            })),
          },
          null,
          2,
        ),
        { flag: 'wx', mode: 0o600 },
      );
      requireTaskWorkflowBudget(packet.budgetProposal, budget);
    }
  }
  return { runId: run.id, outcome, cleanupConfirmed, fullyAccepted: false };
}
