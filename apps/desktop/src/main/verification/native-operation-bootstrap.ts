import assert from 'node:assert/strict';
import { prepareSkaroOperations } from '@skaro/agent-runtime';
import type { SkaroScope, RuntimeScopedExtensionHost } from '@skaro/timeline';
import type { Services } from '../app-services';
import type { NativeAdmissions } from '../native/admissions';

/** Real catalogue before spawn, actual durable lease on every handler call. No grant or fake run. */
export async function nativeOperationBootstrap(
  services: Services,
  scope: SkaroScope,
  lease: NativeAdmissions,
) {
  const signal = lease.signal;
  const port = services.mcp.operations(scope, lease);
  const catalogue = services.mcp.describe(scope);
  const expected = structuredClone(catalogue);
  assert(catalogue.some((tool) => tool.name === 'get_project_context'));
  const first = catalogue[0]!;
  first.inputSchema.properties = { cannotMutateRegistry: { type: 'string' } };
  assert.deepEqual(services.mcp.describe(scope), expected);
  await assert.rejects(port.catalog(lease.admission, signal), /not active/);
  await assert.rejects(
    port.execute({
      admission: lease.admission,
      callId: 'before-native-spawn',
      name: 'get_project_context',
      args: {},
      signal,
    }),
    /not active/,
  );
  const extensions = prepareSkaroOperations(
    port,
    lease.admission,
    expected,
    [{ name: 'get_project_context', readOnly: true }],
    signal,
  );
  const bound: RuntimeScopedExtensionHost = {
    scope,
    admission: lease.admission,
    signal,
    extensions,
  };
  return {
    bound,
    name: extensions.tools[0]!.name,
    async requireActive() {
      assert.deepEqual(await port.catalog(lease.admission, signal), expected);
    },
    async requireRevoked() {
      await assert.rejects(port.catalog(lease.admission, new AbortController().signal));
      await assert.rejects(
        port.execute({
          admission: lease.admission,
          callId: 'after-native-revoke',
          name: 'get_project_context',
          args: {},
          signal: new AbortController().signal,
        }),
      );
    },
  };
}
