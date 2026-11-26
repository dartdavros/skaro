import type { CoordinationBlocker } from '@skaro/core';
import type { WorkflowPublication } from '@skaro/mcp-server';
import type { TaskRunEngine } from './task-run-engine';
import { inspectWorkflowPublication } from './workflow-publication';

export function isWorkflowIncident(row: CoordinationBlocker) {
  return (
    row.subject.kind === 'run' &&
    row.protocol?.cause === 'external' &&
    ['github_manual_workflow_publication_missing', 'github_workflow_publication_missing'].includes(
      row.protocol.code,
    )
  );
}

export async function inspectIncidentWorkflow(
  ctx: TaskRunEngine,
  row: CoordinationBlocker,
  request: WorkflowPublication,
) {
  const run = ctx.deps.db.getRun(row.subject.id);
  if (
    !isWorkflowIncident(row) ||
    !run ||
    run.projectId !== row.projectId ||
    !row.protocol!.subscriptions.every((sub) => sub.runId === run.id && sub.taskId === run.taskId)
  )
    throw new Error(
      'Workflow publication verification requires an external workflow publication incident on its own task run.',
    );
  const context = ctx.project(row.projectId);
  return inspectWorkflowPublication(
    context,
    await context.store.readTask(run.taskId),
    run,
    request,
  );
}
