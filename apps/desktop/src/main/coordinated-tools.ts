import type { AppDb, CoordinationRef } from '@skaro/core';
import type { SkaroScope, Tool, ToolResult } from '@skaro/mcp-server';
import type { ProjectCoordinators } from './project-coordinators';
import { coordinationHash } from './project-coordinator-request';
import { resourcesFor } from './resource-execution';
import { auditToolsAllowed, isAuditChat } from './c4-audit-admission';

const reads = new Set([
  'read_project_incidents',
  'read_project_memory',
  'get_project_context',
  'get_c4_context',
  'read_task_history',
  'read_chat_history',
]);
const controls = new Set([
  'finish_c4_audit',
  'decide_project_incident',
  'report_task_blocker',
  'request_secret',
  'resume_task',
  'control_plan',
]);
const mutations = new Set([
  'migrate_c4_documents',
  'propose_c4',
  'review_c4',
  'merge_task',
  'submit_result',
  'start_environment',
  'configure_environment',
  'setup_environment',
  'manage_dependency_cache',
  'managed_build',
  'verify_integration',
  'ci_run',
  'prepare_plan',
  'propose_saved_plan',
  'finish_plan',
  'write_doc',
  'propose_adr',
  'propose_spec',
  'stage_artifact',
  'finish_import',
  'propose_milestones',
  'propose_tasks',
  'update_task',
  'replan_tasks',
]);

export function coordinationToolSubject(scope: SkaroScope): CoordinationRef {
  if (scope.kind === 'integration' && scope.integrationId)
    return { kind: 'integration', id: scope.integrationId };
  if (scope.kind === 'task' && scope.taskId) return { kind: 'task', id: scope.taskId };
  if (scope.kind === 'project_chat' && scope.chatId) return { kind: 'chat', id: scope.chatId };
  throw new Error('Project operation has no bound subject');
}

/** Both HTTP and internal tools pass through the same authorized existing handler exactly once. */
export function coordinatedTools(
  db: AppDb,
  coordinators: ProjectCoordinators,
  tools: Tool<SkaroScope>[],
): Tool<SkaroScope>[] {
  return tools.map((original) => {
    const tool = {
      ...original,
      available: (scope: SkaroScope) =>
        (!original.available || original.available(scope)) &&
        (!(scope.chatId && isAuditChat(db, scope.chatId)) || auditToolsAllowed.has(original.name)),
    };
    if (reads.has(tool.name))
      return {
        ...tool,
        call: (args, scope, identity) => {
          const resources = resourcesFor(db);
          if (!resources) return tool.call(args, scope, identity);
          if (!identity) throw new Error('Project read requires a bound transport identity');
          const subject = coordinationToolSubject(scope);
          return resources.scope(
            scope.projectId,
            `${subject.kind}:${subject.id}`,
            () => tool.call(args, scope, identity),
            {
              intentId: identity.id,
              requireCurrent: () => identity.requireActive(),
            },
          );
        },
      };
    if (!mutations.has(tool.name) && !controls.has(tool.name))
      throw new Error(`Missing project coordination policy for ${tool.name}`);
    return {
      ...tool,
      call: async (args, scope, identity): Promise<ToolResult> => {
        if (!identity) throw new Error('Project operation requires a bound transport identity');
        const subject = coordinationToolSubject(scope);
        const version = coordinators.version(scope.projectId);
        const previous = db.coordination.getOperation(scope.projectId, identity.id);
        const mode = controls.has(tool.name) ? 'control' : 'mutation';
        return coordinators.execute(
          {
            id: identity.id,
            projectId: scope.projectId,
            action: `mcp.${tool.name}`,
            source: { kind: 'worker', id: identity.sourceId },
            subject,
            inputHash: coordinationHash({ args, scope }),
            mode,
            scopeKey: mode === 'mutation' ? 'project' : `control:${subject.kind}:${subject.id}`,
            ...(mode === 'mutation'
              ? { expectedVersion: previous?.expectedVersion ?? version }
              : {}),
          },
          () => {
            const resources = resourcesFor(db);
            const effect = () => tool.call(args, scope, identity);
            return resources
              ? resources.scope(scope.projectId, `${subject.kind}:${subject.id}`, effect, {
                  intentId: identity.id,
                  requireCurrent: () => identity.requireActive(),
                })
              : effect();
          },
          {
            validate: () => identity.requireActive(),
            // A returned error is a terminal handler receipt, NOT proof of rollback/no effect.
            // No same-ID retry is allowed; a thrown/lost result remains uncertain in the dispatcher.
            outcome: (result) => (result.isError ? 'failed' : 'succeeded'),
            evidence: (result) => ({
              code: result.isError ? 'handler_failed_partial_effects_possible' : 'handler_receipt',
              refs: [subject],
              fingerprint: coordinationHash(result),
            }),
            replay: () => {
              const operation = db.coordination.getOperation(scope.projectId, identity.id)!;
              return {
                text: 'This operation already completed. The saved receipt is returned; the handler was not repeated. Read the project context for current results.',
                structuredContent: {
                  coordination: {
                    operationId: operation.id,
                    state: operation.state,
                    evidence: operation.evidence,
                    replayedReceipt: true,
                  },
                },
              };
            },
          },
        );
      },
    };
  });
}
