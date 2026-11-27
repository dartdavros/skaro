import type { SkaroScope, Tool, ToolResult } from '@skaro/mcp-server';
import type { IntegrationOperation } from './integration-model';
import type { TaskRunEngine } from './task-run-engine';
import { integrationFailure } from './integration-failure';

export function integrationBlockerTool(
  report: (reason: string, scope: SkaroScope) => Promise<ToolResult>,
): Tool<SkaroScope> {
  return {
    name: 'report_integration_blocker',
    description:
      'Record an evidenced obstacle on this integration candidate. State the exact failed prerequisite, tool outcome, and attempted authorized remedy. Use the existing question or permission tool when an owner decision is needed.',
    available: (scope) => scope.kind === 'integration',
    inputSchema: {
      type: 'object',
      properties: { reason: { type: 'string', minLength: 1, maxLength: 4000 } },
      required: ['reason'],
      additionalProperties: false,
    },
    async call(args, scope) {
      if (scope.kind !== 'integration')
        return { text: 'This tool requires an integration worker.', isError: true };
      const reason = typeof args.reason === 'string' ? args.reason.trim() : '';
      if (!reason || reason.length > 4000)
        return { text: 'Provide the concrete integration obstacle.', isError: true };
      return report(reason, scope);
    },
  };
}

export class IntegrationRecoveryExhausted extends Error {}

/** A normal model final is not a pending owner decision. Give the candidate one recovery pass. */
export async function recoverUnfinishedIntegration(ctx: TaskRunEngine, op: IntegrationOperation) {
  const integration = ctx.integrations;
  integration.assertExecuting(op);
  const reason = op.blocker?.reason ?? integrationFailure(op);
  if (op.coordinatorRecovery || op.attempts >= 3) throw new IntegrationRecoveryExhausted(reason);
  op.coordinatorRecovery = true;
  op.error = reason;
  op.state = 'resolving';
  // A new resolver turn gets the exact persisted candidate and diagnosis, with no replay of old tool calls.
  op.nativeAgent = undefined;
  op.nativeSessionId = undefined;
  integration.service.save(op);
  await integration.history.notice(op, `Интеграция будет продолжена. ${reason}`);
  setImmediate(() => integration.enqueue(op));
}
