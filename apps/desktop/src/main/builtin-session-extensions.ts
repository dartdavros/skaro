import assert from 'node:assert/strict';
import type { RuntimeExtensionHost, RuntimeScopedExtensionHost } from '@skaro/timeline';
import type { BuiltinSessionPreparation } from './builtin-session-models';

/** Combine real scoped hosts; a second port cannot replace a tool or another session's authority. */
export function builtinSessionExtensions(
  input: BuiltinSessionPreparation,
  skaro: RuntimeExtensionHost,
  supplied?: RuntimeScopedExtensionHost,
): RuntimeExtensionHost {
  if (supplied) {
    assert.deepEqual(supplied.scope, input.scope);
    assert.deepEqual(supplied.admission, input.admissions.admission);
    supplied.signal?.throwIfAborted();
  }
  const hosts = supplied ? [skaro, supplied.extensions] : [skaro];
  const tools = hosts.flatMap((host) => [...host.tools]);
  assert(
    tools.length <= 64 && new Set(tools.map((tool) => tool.name)).size === tools.length,
    'Session extension names must be unique and bounded',
  );
  let closed: Promise<void> | undefined;
  const close = () =>
    (closed ??= Promise.all(hosts.map((host) => host.close())).then(() => undefined));
  return {
    tools,
    async interrupt() {
      await Promise.all(hosts.map((host) => host.interrupt?.() ?? host.close()));
    },
    close,
  };
}
