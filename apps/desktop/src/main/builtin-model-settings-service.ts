import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type {
  Connection,
  CredentialBinding,
  ProcessAdmission,
  ProcessAdmissionPort,
  Route,
  RouteSnapshot,
} from '@skaro/timeline';
import type { BuiltinModelConfigurationStore } from './builtin-model-configuration';
import { ModelCredentialVault } from './credentials/vault';
import { credentialRecoveryDecision } from './builtin-credential-recovery';
import { protection } from './credentials/protection';
import { bindConfiguredCredentials } from './builtin-configured-credentials';

/** Main-only serialized settings. Durable metadata precedes every OS-vault mutation. */
export class BuiltinModelSettingsService {
  private readonly store: BuiltinModelConfigurationStore;
  private readonly directory: string;
  private vault?: ModelCredentialVault;
  private queue: Promise<unknown> = Promise.resolve();
  private closed = false;
  private readonly lifetime = new AbortController();
  constructor(store: BuiltinModelConfigurationStore, dataDir: string) {
    this.store = store;
    this.directory = join(dataDir, 'credentials');
  }
  private credentials() {
    return (this.vault ??= new ModelCredentialVault(this.directory));
  }
  private serialize<T>(work: () => Promise<T>) {
    const result = this.queue.then(() => {
      if (this.closed) throw new Error('Model settings service is closing');
      return work();
    });
    this.queue = result.catch(() => undefined);
    return result;
  }
  private async recover() {
    const pending = this.store.pendingCredential();
    if (!pending) return;
    const actual = (await this.credentials().metadata()).find(
      (entry) => entry.binding.connectionId === pending.connectionId,
    );
    this.store.finishCredential(
      pending.id,
      credentialRecoveryDecision(pending, actual) === 'commit',
    );
  }
  read() {
    return this.serialize(async () => {
      await this.recover();
      const availability = protection();
      return {
        configuration: this.store.read(),
        protection: availability,
        credentials: availability.state === 'available' ? await this.credentials().metadata() : [],
      };
    });
  }
  /** Host-only: share the same OS vault owner used by settings; never expose this through IPC. */
  credentialsFor(
    route: RouteSnapshot,
    admission: ProcessAdmission,
    admissions: Pick<ProcessAdmissionPort, 'requireActive'>,
    signal: AbortSignal,
  ) {
    const expected = structuredClone(route);
    const owner = structuredClone(admission);
    return this.serialize(async () => {
      const active = AbortSignal.any([signal, this.lifetime.signal]);
      active.throwIfAborted();
      await this.recover();
      return bindConfiguredCredentials(
        this.store,
        this.credentials(),
        expected,
        owner,
        admissions,
        active,
      );
    });
  }
  saveConnection(
    expectedRevision: number,
    connection: Omit<Connection, 'credential'>,
    secret?: string,
  ) {
    // The IPC handler validates before entering this method. Never put secret in durable metadata.
    const draft = structuredClone(connection);
    const buffer = secret === undefined ? undefined : Buffer.from(secret);
    return this.serialize(async () => {
      await this.recover();
      const state = this.store.read();
      if (state.revision !== expectedRevision)
        throw new Error('Builtin model configuration revision conflict');
      const vault = this.credentials();
      const old =
        (await vault.metadata()).find((entry) => entry.binding.connectionId === draft.id) ?? null;
      const binding: CredentialBinding = {
        connectionId: draft.id,
        connectionRevision: draft.revision,
        endpoint: draft.endpoint,
      };
      const reference = buffer
        ? { id: old?.reference.id ?? randomUUID(), revision: (old?.reference.revision ?? 0) + 1 }
        : await vault.reference(binding);
      if (!reference) throw new Error('An API key is required for this connection');
      const next = { ...draft, credential: reference };
      const choices = {
        connections: [...state.connections.filter((item) => item.id !== next.id), next],
        routes: state.routes,
      };
      if (!buffer) return this.store.update(expectedRevision, choices);
      const pending = this.store.prepareCredential(expectedRevision, {
        connectionId: next.id,
        previous: old,
        next: { binding, reference },
        choices,
      });
      try {
        await vault.replace({
          binding,
          expected: old?.reference ?? null,
          planned: reference,
          secret: buffer,
        });
        this.store.finishCredential(pending.id, true);
      } catch (error) {
        await this.recover();
        throw error;
      }
      return this.store.read();
    }).finally(() => buffer?.fill(0));
  }
  saveRoute(expectedRevision: number, route: Route) {
    return this.serialize(async () => {
      await this.recover();
      const state = this.store.read();
      return this.store.update(expectedRevision, {
        connections: state.connections,
        routes: [...state.routes.filter((item) => item.id !== route.id), route],
      });
    });
  }
  remove(expectedRevision: number, kind: 'route' | 'connection', id: string) {
    return this.serialize(async () => {
      await this.recover();
      const state = this.store.read();
      if (state.revision !== expectedRevision)
        throw new Error('Builtin model configuration revision conflict');
      if (
        kind === 'connection'
          ? !state.connections.some((item) => item.id === id)
          : !state.routes.some((item) => item.id === id)
      )
        throw new Error('Configured model settings entry is unavailable');
      const choices = {
        connections: state.connections.filter((item) => kind !== 'connection' || item.id !== id),
        routes: state.routes.filter((item) =>
          kind === 'route' ? item.id !== id : item.connectionId !== id,
        ),
      };
      if (kind === 'route') return this.store.update(expectedRevision, choices);
      const vault = this.credentials();
      const old =
        (await vault.metadata()).find((entry) => entry.binding.connectionId === id) ?? null;
      if (!old) return this.store.update(expectedRevision, choices);
      const pending = this.store.prepareCredential(expectedRevision, {
        connectionId: id,
        previous: old,
        next: null,
        choices,
      });
      try {
        await vault.revoke(old.binding, old.reference);
        this.store.finishCredential(pending.id, true);
      } catch (error) {
        await this.recover();
        throw error;
      }
      return this.store.read();
    });
  }
  async close() {
    this.closed = true;
    this.lifetime.abort();
    await this.queue;
    await this.vault?.close();
  }
}
