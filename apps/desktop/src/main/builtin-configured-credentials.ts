import { isDeepStrictEqual } from 'node:util';
import type {
  CredentialPort,
  ProcessAdmission,
  ProcessAdmissionPort,
  RouteSnapshot,
} from '@skaro/timeline';
import type { BuiltinModelConfigurationStore } from './builtin-model-configuration';
import type { ModelCredentialVault } from './credentials/vault';

/** Main-only authority. Configuration and OS ownership do not prove model/profile availability. */
export async function bindConfiguredCredentials(
  store: BuiltinModelConfigurationStore,
  vault: ModelCredentialVault,
  route: RouteSnapshot,
  admission: ProcessAdmission,
  admissions: Pick<ProcessAdmissionPort, 'requireActive'>,
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  const expected = structuredClone(route);
  const owner = structuredClone(admission);
  const connection = store.read().connections.find((entry) => entry.id === expected.connectionId);
  if (!connection) throw new Error('Configured model connection is unavailable');
  const lease = store.admit(expected, connection.credential);
  const active = AbortSignal.any([signal, lease.signal]);
  const close = () => {
    signal.removeEventListener('abort', close);
    lease.close();
  };
  signal.addEventListener('abort', close, { once: true });
  lease.signal.addEventListener('abort', () => signal.removeEventListener('abort', close), {
    once: true,
  });
  const requireActive = async (value: ProcessAdmission, check: AbortSignal) => {
    lease.requireCurrent(check);
    await admissions.requireActive(value, check);
    lease.requireCurrent(check);
  };
  try {
    const binding = {
      connectionId: connection.id,
      connectionRevision: connection.revision,
      endpoint: connection.endpoint,
    };
    const reference = await vault.reference(binding);
    lease.requireCurrent(active);
    if (!reference || !isDeepStrictEqual(reference, connection.credential))
      throw new Error('Configured credential reference is unavailable');
    // Model hosts are constructed before native spawn. Only the port's request may borrow a key,
    // and its vault admission callback requires the real process to have become active.
    const auth = { binding, reference, admission: owner };
    const port = vault.port(auth, { requireActive }, active);
    const credentials: CredentialPort = {
      withCredential: (request, consume) => {
        const combined = AbortSignal.any([active, request.signal]);
        lease.requireCurrent(combined);
        return port.withCredential({ ...request, signal: combined }, async (secret, borrowed) => {
          lease.requireCurrent(borrowed);
          const result = await consume(secret, borrowed);
          lease.requireCurrent(borrowed);
          return result;
        });
      },
    };
    return { auth, credentials, signal: active, close };
  } catch (error) {
    close();
    throw error;
  }
}
