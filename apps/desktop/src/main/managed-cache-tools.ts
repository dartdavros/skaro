import type { AppDb } from '@skaro/core';
import type { SkaroScope, Tool, ToolResult } from '@skaro/mcp-server';
import type { TaskRuns } from './tasks';
import type { ManagedCaches } from './managed-caches';
import { managedTaskSource } from './managed-cache-worktree';
import { managedContextArgument } from './managed-cache-context';

/** Only narrow a pinned task root; no external cwd, flags, budgets or provenance assertions. */
export function managedCacheArguments(
  args: Record<string, unknown>,
  kind: 'dependencies' | 'buildkit',
) {
  const keys = kind === 'dependencies' ? ['action', 'context'] : ['context'];
  if (Object.keys(args).some((key) => !keys.includes(key)))
    throw new Error(
      kind === 'dependencies'
        ? 'managed_dependencies_arguments_invalid'
        : 'managed_build_arguments_invalid',
    );
  managedContextArgument(args.context);
  if (kind === 'buildkit') return 'verify' as const;
  if (!['publish', 'install'].includes(String(args.action)))
    throw new Error('managed_dependencies_arguments_invalid');
  return args.action as 'publish' | 'install';
}
export async function managedTaskDirectory(db: AppDb, dataDir: string, scope: SkaroScope) {
  return (await managedTaskSource(db, dataDir, scope)).cwd;
}

export function managedCacheTools(
  db: AppDb,
  dataDir: string,
  caches: ManagedCaches,
  runs: () => TaskRuns,
): Tool<SkaroScope>[] {
  const tool = (kind: 'dependencies' | 'buildkit'): Tool<SkaroScope> => ({
    name: kind === 'dependencies' ? 'manage_dependency_cache' : 'managed_build',
    description:
      kind === 'dependencies'
        ? 'Publish or consume Skaro-owned immutable public npm v2/v3 or pinned pnpm 10.11 lock-v9 dependencies for THIS current isolated task run, optionally in a relative subproject context. Uses real lock integrity, exact tool/platform/configuration and captured original manifests. Consumer uses a verified writable clone and frozen offline scripts-disabled install; pnpm links and generated shims stay task-local and are not executed. No shared node_modules, global package store/settings, private registry/config/hooks/workspaces or yarn. Unsupported means not installed; never fabricate/convert a lockfile or treat this as full project setup.'
        : 'Verify a CACHEONLY Dockerfile solve for THIS current isolated task run, optionally within a relative context, using a dedicated identity-verified Skaro builder. No deployed/loaded image or project services. Bounded tracked source snapshots and exact recipe/source identity are checked. Scratch recipes are offline; trusted single-stage pinned official-base RUN recipes require a separate host-owner approval bound to exact source and network policy, not a tool argument. No custom frontend, secret/SSH mounts, external contexts or caller build flags. Do not fabricate Dockerfiles or replace owner compose/build commands; unsupported or approval-required is not success.',
    available: (scope) =>
      scope.kind === 'task' && !!scope.runId && !!scope.taskId && !scope.importId,
    inputSchema: {
      type: 'object',
      properties: {
        ...(kind === 'dependencies'
          ? { action: { type: 'string', enum: ['publish', 'install'] } }
          : {}),
        context: {
          type: 'string',
          description:
            'Relative subproject directory inside the current isolated task root; default dot. No absolute or parent paths.',
        },
      },
      ...(kind === 'dependencies' ? { required: ['action'] } : {}),
      additionalProperties: false,
    },
    call: async (args, scope): Promise<ToolResult> =>
      runs().scopedTool(scope, async () => {
        try {
          const action = managedCacheArguments(args, kind);
          const source = await managedTaskSource(db, dataDir, scope),
            cwd = source.cwd,
            context = managedContextArgument(args.context);
          const result =
            kind === 'dependencies'
              ? await caches.dependencies(
                  scope.projectId,
                  cwd,
                  action === 'install',
                  source,
                  context,
                )
              : await caches.build(scope.projectId, cwd, source, context);
          return { text: JSON.stringify(result), structuredContent: result };
        } catch (error) {
          const message =
            error instanceof Error && /^[a-z][a-z0-9_]+$/.test(error.message)
              ? error.message
              : 'managed_cache_operation_failed';
          const state =
            message.includes('unsupported') ||
            message.includes('no_npm_lock') ||
            message.includes('no_dockerfile')
              ? 'unsupported'
              : 'retained';
          const receipt = `${state}:${message}`,
            key = `resources.cache-outcome.${scope.projectId}.${scope.runId}.${kind}.${contextOutcome(args.context)}`;
          if (db.getSetting(key, '') !== receipt) {
            db.setSetting(key, receipt);
            db.addEvent(scope.projectId, 'resource_cache', {
              state,
              reason: message,
              runId: scope.runId,
              kind,
            });
          }
          return {
            text: JSON.stringify({ state, reason: message, success: false }),
            isError: true,
          };
        }
      }),
  });
  return [tool('dependencies'), tool('buildkit')];
}
function contextOutcome(context: unknown) {
  try {
    return encodeURIComponent(managedContextArgument(context));
  } catch {
    return 'invalid';
  }
}
