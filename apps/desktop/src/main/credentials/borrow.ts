import type { CredentialBinding, CredentialReference } from '@skaro/timeline';
import type { CredentialStore } from './store';
import type { CredentialLeases } from './leases';
import { decryptCredential } from './protection';

/** One envelope validation for model and metadata consumers, inside the vault's serialized gate. */
export function borrowCredential(
  store: CredentialStore,
  leases: CredentialLeases,
  binding: CredentialBinding,
  reference: CredentialReference,
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  const row = store.get(binding.connectionId);
  const matchesBinding = (value: CredentialBinding) =>
    row &&
    row.connection === value.connectionId &&
    row.revision === value.connectionRevision &&
    row.endpoint === value.endpoint;
  const matchesReference = (value: CredentialReference) =>
    row && row.id === value.id && row.version === value.revision;
  if (!row || !matchesBinding(binding) || !matchesReference(reference))
    throw new Error('Credential binding or revision conflict');
  const value = decryptCredential(row.encrypted) as {
    schema?: number;
    binding?: CredentialBinding;
    reference?: CredentialReference;
    secret?: string;
  };
  if (
    value?.schema !== 1 ||
    !value.binding ||
    !value.reference ||
    !matchesBinding(value.binding) ||
    !matchesReference(value.reference) ||
    typeof value.secret !== 'string'
  )
    throw new Error('Credential envelope mismatch');
  return {
    ...leases.open(binding.connectionId, signal),
    secret: Buffer.from(value.secret, 'base64'),
  };
}
