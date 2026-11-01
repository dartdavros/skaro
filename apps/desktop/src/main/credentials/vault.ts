import { randomUUID } from 'node:crypto';
import {
  validateModelEndpoint,
  type CredentialBinding,
  type CredentialPort,
  type CredentialReference,
  type CredentialVault,
  type ProcessAdmission,
  type ProcessAdmissionPort,
} from '@skaro/timeline';
import { CredentialStore, type StoredCredential } from './store';
import { CredentialLeases } from './leases';
import { decryptCredential, encryptCredential, protection, requireProtection } from './protection';

function validateBinding(binding: CredentialBinding): void {
  if (
    !/^[a-zA-Z0-9_-]{1,160}$/.test(binding.connectionId) ||
    !Number.isSafeInteger(binding.connectionRevision) ||
    binding.connectionRevision < 1
  )
    throw new Error('Invalid credential binding');
  validateModelEndpoint(binding.endpoint);
}
function matches(
  row: StoredCredential | undefined,
  reference: CredentialReference | null,
): boolean {
  return reference === null ? !row : row?.id === reference.id && row.version === reference.revision;
}
function sameBinding(row: StoredCredential, binding: CredentialBinding): boolean {
  return (
    row.connection === binding.connectionId &&
    row.revision === binding.connectionRevision &&
    row.endpoint === binding.endpoint
  );
}
function sameAdmission(a: ProcessAdmission, b: ProcessAdmission): boolean {
  return a.id === b.id && a.sessionId === b.sessionId && a.generation === b.generation;
}

/** Main-process only; one OS-protected store owner, no renderer or command-environment access. */
export class ModelCredentialVault implements CredentialVault {
  private readonly store: CredentialStore;
  private readonly leases = new CredentialLeases();
  private queue: Promise<unknown> = Promise.resolve();
  private closing?: Promise<void>;
  constructor(directory: string) {
    requireProtection();
    this.store = new CredentialStore(directory);
  }
  async availability() {
    return protection();
  }
  /** Main-only references. No encrypted envelope or secret bytes are returned. */
  metadata() {
    return this.serialize(() => {
      this.requireOpen();
      return this.store.metadata().map((row) => ({
        binding: {
          connectionId: row.connection,
          connectionRevision: row.revision,
          endpoint: row.endpoint,
        },
        reference: { id: row.id, revision: row.version },
      }));
    });
  }
  /** Nonsecret configuration reference only; never decrypt or return the envelope. */
  reference(binding: CredentialBinding): Promise<CredentialReference | undefined> {
    const target = structuredClone(binding);
    return this.serialize(() => {
      this.requireOpen();
      validateBinding(target);
      const row = this.store.get(target.connectionId);
      if (!row) return undefined;
      if (!sameBinding(row, target)) throw new Error('Credential binding mismatch');
      return { id: row.id, revision: row.version };
    });
  }

  private serialize<T>(work: () => Promise<T> | T): Promise<T> {
    const result = this.queue.then(work);
    this.queue = result.catch(() => undefined);
    return result;
  }
  private requireOpen(): void {
    if (this.closing) throw new Error('Credential vault is closing');
    requireProtection();
  }

  replace(input: {
    binding: CredentialBinding;
    expected: CredentialReference | null;
    secret: Uint8Array;
    planned?: CredentialReference;
  }) {
    // Own a copy before queueing; the caller retains responsibility for its input buffer.
    const secret = Uint8Array.from(input.secret);
    const binding = structuredClone(input.binding);
    const expected = input.expected && { ...input.expected };
    const planned = input.planned && { ...input.planned };
    return this.serialize(async () => {
      this.requireOpen();
      validateBinding(binding);
      if (
        !secret.length ||
        secret.length > 16_384 ||
        !/^[\x21-\x7e]+$/.test(Buffer.from(secret).toString('utf8'))
      )
        throw new Error('Credential must be a nonempty printable ASCII API token');
      const row = this.store.get(binding.connectionId);
      if (!matches(row, expected)) throw new Error('Credential revision conflict');
      const reference = planned ?? {
        id: row?.id ?? randomUUID(),
        revision: (row?.version ?? 0) + 1,
      };
      if (
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          reference.id,
        ) ||
        reference.revision !== (row?.version ?? 0) + 1 ||
        (row && reference.id !== row.id)
      )
        throw new Error('Invalid planned credential revision');
      await this.leases.revoke(binding.connectionId);
      const encrypted = encryptCredential({
        schema: 1,
        binding,
        reference,
        secret: Buffer.from(secret).toString('base64'),
      });
      this.store.put({
        connection: binding.connectionId,
        revision: binding.connectionRevision,
        endpoint: binding.endpoint,
        id: reference.id,
        version: reference.revision,
        encrypted,
      });
      return reference;
    }).finally(() => secret.fill(0));
  }

  revoke(binding: CredentialBinding, expected: CredentialReference): Promise<void> {
    const target = structuredClone(binding);
    const reference = { ...expected };
    return this.serialize(async () => {
      this.requireOpen();
      validateBinding(target);
      const row = this.store.get(target.connectionId);
      if (!row || !sameBinding(row, target) || !matches(row, reference))
        throw new Error('Credential binding or revision conflict');
      await this.leases.revoke(target.connectionId);
      this.store.delete(target.connectionId);
    });
  }

  /** A port is bound by the privileged host, not by runtime/model-supplied request metadata. */
  port(
    bound: {
      binding: CredentialBinding;
      reference: CredentialReference;
      admission: ProcessAdmission;
    },
    admissions: Pick<ProcessAdmissionPort, 'requireActive'>,
    admissionSignal: AbortSignal,
  ): CredentialPort {
    const allowed = structuredClone(bound);
    validateBinding(allowed.binding);
    return {
      withCredential: async (request, consume) => {
        const signal = AbortSignal.any([request.signal, admissionSignal]);
        const requested = structuredClone({
          binding: request.binding,
          reference: request.reference,
          admission: request.admission,
        });
        const lease = await this.serialize(async () => {
          this.requireOpen();
          signal.throwIfAborted();
          if (
            !sameAdmission(requested.admission, allowed.admission) ||
            requested.binding.connectionId !== allowed.binding.connectionId ||
            requested.binding.connectionRevision !== allowed.binding.connectionRevision ||
            requested.binding.endpoint !== allowed.binding.endpoint ||
            requested.reference.id !== allowed.reference.id ||
            requested.reference.revision !== allowed.reference.revision
          )
            throw new Error('Credential port scope mismatch');
          await admissions.requireActive(allowed.admission, signal);
          signal.throwIfAborted();
          const row = this.store.get(allowed.binding.connectionId);
          if (!row || !matches(row, allowed.reference) || !sameBinding(row, allowed.binding))
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
            !sameBinding(row, value.binding) ||
            !matches(row, value.reference) ||
            typeof value.secret !== 'string'
          )
            throw new Error('Credential envelope mismatch');
          const secret = Buffer.from(value.secret, 'base64');
          const lease = this.leases.open(allowed.binding.connectionId, signal);
          return { ...lease, secret };
        });
        try {
          lease.signal.throwIfAborted();
          await admissions.requireActive(allowed.admission, lease.signal);
          lease.signal.throwIfAborted();
          const value = await consume(lease.secret, lease.signal);
          lease.signal.throwIfAborted();
          return value;
        } catch {
          // Provider/OS errors may contain headers or token values; none crosses this boundary.
          throw new Error(
            lease.signal.aborted
              ? 'Credential lease revoked or cancelled'
              : 'Credential consumer failed',
          );
        } finally {
          lease.secret.fill(0);
          lease.close();
        }
      },
    };
  }

  close(): Promise<void> {
    this.closing ??= this.serialize(async () => {
      await this.leases.revoke();
      this.store.close();
    });
    return this.closing;
  }
}
