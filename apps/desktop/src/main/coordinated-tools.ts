import type { AppDb, CoordinationRef } from '@skaro/core';
import type { SkaroScope, Tool, ToolResult } from '@skaro/mcp-server';
import type { ProjectCoordinators } from './project-coordinators';
import { coordinationHash } from './project-coordinator-request';
import { resourcesFor } from './resource-execution';
import { auditToolsAllowed, isAuditChat } from './c4-audit-admission';
import { environmentToolPolicy } from './coordinated-tool-policy';
import { coordinationToolReceipt, coordinationToolScopeKey } from './coordination-tool-receipt';
import { executeTaskTool } from './task-tool-receipts';

const reads = new Set([
  'read_project_incidents',
  'read_project_memory',
  'get_project_context',
  'get_c4_context',
  'read_task_history',
  'read_chat_history',
  'reconcile_task_merge',
]);
const controls = new Set([
  'ask_owner',
  'plan_project_incident',
  'verify_project_incident',
  'cancel_question',
  'finish_c4_audit',
  'decide_project_incident',
  'report_task_blocker',
  'report_integration_blocker',
  'reconcile_task_submission',
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
  'begin_task_plan',
  'revise_plan',
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
  'delete_tasks',
  'delete_task',
  'set_task_status',
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
        (![
          'get_c4_context',
          'propose_c4',
          'review_c4',
          'migrate_c4_documents',
          'finish_c4_audit',
        ].includes(original.name) ||
          (scope.kind === 'project_chat' && !!scope.chatId && isAuditChat(db, scope.chatId))) &&
        (!(scope.kind === 'task' || scope.kind === 'integration') ||
          ![
            'read_project_incidents',
            'plan_project_incident',
            'verify_project_incident',
            'decide_project_incident',
          ].includes(original.name)) &&
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
        if (scope.kind === 'task' || scope.kind === 'integration') {
          await identity.requireActive();
          const resources = resourcesFor(db);
          const effect = async () => {
            await identity.requireActive();
            return tool.call(args, scope, identity);
          };
          const dispatch = () => executeTaskTool(db, scope, tool.name, args, identity.id, effect);
          return resources
            ? resources.scope(scope.projectId, `${subject.kind}:${subject.id}`, dispatch, {
                intentId: identity.id,
                requireCurrent: () => identity.requireActive(),
              })
            : dispatch();
        }
        const version = coordinators.version(scope.projectId);
        const previous = db.coordination.getOperation(scope.projectId, identity.id);
        const ownerPark =
          tool.name === 'set_task_status' &&
          scope.kind === 'project_chat' &&
          (args.status === 'paused' || args.status === 'stopped');
        const policy = ownerPark
          ? { mode: 'control' as const, scopeKey: `stop:${identity.id}` }
          : environmentToolPolicy(db, tool.name, args, scope);
        const mode = policy?.mode ?? (controls.has(tool.name) ? 'control' : 'mutation');
        return coordinationToolReceipt(tool.name, () =>
          coordinators.execute(
            {
              id: identity.id,
              projectId: scope.projectId,
              action: `mcp.${tool.name}`,
              source: { kind: 'worker', id: identity.sourceId },
              subject,
              inputHash: coordinationHash({ args, scope }),
              mode,
              scopeKey: coordinationToolScopeKey(
                tool.name,
                identity.id,
                policy?.scopeKey ??
                  (mode === 'mutation' ? 'project' : `control:${subject.kind}:${subject.id}`),
                args,
                scope.projectId,
              ),
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
              outcome: (result) => (result.isError ? 'failed' : 'succeeded'),
              evidence: (result) => ({
                code: result.isError
                  ? 'handler_failed_partial_effects_possible'
                  : 'handler_receipt',
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
          ),
        );
      },
    };
  });
}
