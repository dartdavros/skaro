import { isDeepStrictEqual } from 'node:util';
import {
  configuredRouteSnapshot,
  type BuiltinModelConfiguration,
  type RouteSnapshot,
  type CredentialReference,
} from '@skaro/timeline';

/** Configuration authority only. Credential, process, budget and profile gates remain independent. */
export class BuiltinModelRouteLease {
  private readonly controller = new AbortController();
  private readonly expected: RouteSnapshot;
  private readonly credential: CredentialReference;
  private readonly read: () => BuiltinModelConfiguration;
  private readonly release: (lease: BuiltinModelRouteLease) => void;
  get signal() {
    return this.controller.signal;
  }
  constructor(
    read: () => BuiltinModelConfiguration,
    route: RouteSnapshot,
    credential: CredentialReference,
    release: (lease: BuiltinModelRouteLease) => void,
  ) {
    this.read = read;
    this.expected = structuredClone(route);
    this.credential = structuredClone(credential);
    this.release = release;
    this.requireCurrent();
  }
  private matches() {
    try {
      const config = this.read();
      const route = config.routes.find((entry) => entry.id === this.expected.routeId);
      const connection = config.connections.find(
        (entry) => entry.id === this.expected.connectionId,
      );
      return (
        !!route &&
        !!connection &&
        isDeepStrictEqual(connection.credential, this.credential) &&
        isDeepStrictEqual(this.expected, configuredRouteSnapshot(route, config.connections))
      );
    } catch {
      return false;
    }
  }
  requireCurrent(signal?: AbortSignal) {
    signal?.throwIfAborted();
    if (this.signal.aborted || !this.matches()) {
      this.close();
      throw new Error('Builtin model route is unavailable or no longer current');
    }
    signal?.throwIfAborted();
  }
  /** Main commits revoke immediately; independent writers are re-read at every host boundary. */
  refresh() {
    if (!this.matches()) this.close();
  }
  close() {
    if (this.signal.aborted) return;
    this.controller.abort();
    this.release(this);
  }
}
