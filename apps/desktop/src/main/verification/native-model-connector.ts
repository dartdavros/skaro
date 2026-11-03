import assert from 'node:assert/strict';
import { join } from 'node:path';
import { OpenRouterConnector } from '@skaro/agent-runtime';
import { processBirth } from '@skaro/agent-runtime/process-identity';
import type { RuntimeProcessIdentity } from '@skaro/timeline';
import { ModelCredentialVault } from '../credentials/vault';

/** Opens the actual vault and returns its connector. No key is read for a denied reservation. */
export async function nativeVerificationConnector(
  data: string,
  owner: RuntimeProcessIdentity,
  signal: AbortSignal,
) {
  const vault = new ModelCredentialVault(join(data, 'credentials'));
  try {
    const binding = {
      connectionId: 'openrouter-owner',
      connectionRevision: 1,
      endpoint: 'https://openrouter.ai/api/v1',
    };
    const reference = await vault.reference(binding);
    assert(reference, 'The actual owner OpenRouter connection is not configured');
    const admission = {
      id: `native-model-owner-${owner.pid}`,
      sessionId: 'native-model-host',
      generation: 1,
    };
    const auth = { binding, reference, admission };
    const credentials = vault.port(
      auth,
      {
        async requireActive(value, signal) {
          signal.throwIfAborted();
          assert.deepEqual(value, admission);
          assert.equal(await processBirth(owner.pid), owner.birth);
          signal.throwIfAborted();
        },
      },
      signal,
    );
    return { vault, connector: new OpenRouterConnector(credentials, auth), reference };
  } catch (error) {
    await vault.close();
    throw error;
  }
}
