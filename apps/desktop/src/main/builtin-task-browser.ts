import assert from 'node:assert/strict';
import { join } from 'node:path';
import { connectMcpExtension, createMcpImageStore } from '@skaro/agent-runtime';
import { processBirth } from '@skaro/agent-runtime/process-identity';
import type { RuntimeScopedExtensionHost } from '@skaro/timeline';
import type { BuiltinSessionPreparation } from './builtin-session-models';

type Allowed = Parameters<typeof connectMcpExtension>[0]['allowed'];

/** Explicit host allowlist over the task's existing official browser server and process owner. */
export async function prepareBuiltinTaskBrowser(
  input: BuiltinSessionPreparation,
  allowed: Allowed,
  allowFileAccess = false,
): Promise<RuntimeScopedExtensionHost> {
  assert(input.scope.kind === 'task' && input.scope.runId && input.scope.taskId);
  assert(input.options.processStarted, 'Browser process requires the real task ownership callback');
  const server = structuredClone(input.options.mcpServers?.playwright);
  assert(server && server.type === 'stdio');
  assert.equal(server.command, process.execPath);
  assert(server.args.includes('--isolated') && server.args.includes('--headless'));
  if (allowFileAccess) server.args.push('--allow-unrestricted-file-access');
  const signal = AbortSignal.any([input.signal, input.admissions.signal]);
  const extensions = await connectMcpExtension({
    id: 'browser',
    config: server,
    cwd: input.options.cwd,
    signal,
    allowed,
    images: await createMcpImageStore(join(input.artifactDir, 'browser-images')),
    processes: {
      async admit(identity, active) {
        active.throwIfAborted();
        signal.throwIfAborted();
        assert.equal(await processBirth(identity.pid), identity.birth);
        input.options.processStarted!(identity.pid, identity);
      },
      async exited(identity) {
        assert.notEqual(await processBirth(identity.pid), identity.birth);
      },
    },
  });
  return {
    scope: structuredClone(input.scope),
    admission: structuredClone(input.admissions.admission),
    extensions: {
      ...extensions,
      tools: extensions.tools.map((tool) => ({
        ...tool,
        async invoke(id, args, callSignal) {
          const active = AbortSignal.any([signal, callSignal]);
          await input.admissions.requireActive(input.admissions.admission, active);
          const result = await tool.invoke(id, args, active);
          await input.admissions.requireActive(input.admissions.admission, active);
          return result;
        },
      })),
    },
    signal,
  };
}
