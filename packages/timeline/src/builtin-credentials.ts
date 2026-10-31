import type { CredentialReference } from './builtin-model.ts';
import type { ProcessAdmission } from './builtin-host.ts';

export interface CredentialBinding {
  connectionId: string;
  connectionRevision: number;
  /** Exact endpoint, including base path. Changing it requires explicit rebinding. */
  endpoint: string;
}

/** Privileged host configuration API, never provided to a model or a tool executor. */
export interface CredentialVault {
  availability(): Promise<
    | { state: 'available'; backend: 'dpapi' | 'keychain' | 'secret-service' }
    | { state: 'unavailable'; reason: string }
  >;
  /** Atomic compare-and-swap; rotation revokes previous leases before returning. */
  replace(input: {
    binding: CredentialBinding;
    expected: CredentialReference | null;
    secret: Uint8Array;
  }): Promise<CredentialReference>;
  revoke(binding: CredentialBinding, expected: CredentialReference): Promise<void>;
}

/** Only a connector consumes secret bytes in memory. Never serialize results containing them. */
export interface CredentialPort {
  withCredential<T>(
    request: {
      admission: ProcessAdmission;
      binding: CredentialBinding;
      reference: CredentialReference;
      signal: AbortSignal;
    },
    /** The lease signal also aborts on rotation/revocation; consumers must honor it. */
    consume: (secret: Uint8Array, signal: AbortSignal) => Promise<T>,
  ): Promise<T>;
}

// Implementations must fail closed when OS protection is unavailable (including Linux
// basic_text), erase borrowed bytes on exit, and never pass secrets through command env,
// catalog/settings, Git, journal, errors or diagnostics. No plaintext storage fallback.
