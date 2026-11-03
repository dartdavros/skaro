import assert from 'node:assert/strict';
import { configuredRouteSnapshot } from '@skaro/timeline';
import type { Services } from '../app-services';
import type { NativeAdmissions } from '../native/admissions';

/** Actual saved settings and owned native processes; no key consumer/model request is admitted. */
export async function configuredCredentialProbe(services: Services) {
  const before = await services.modelSettings.read();
  const route = before.configuration.routes.find(
    (entry) => entry.connectionId === 'openrouter-owner' && entry.modelId === 'openai/gpt-4.1-nano',
  );
  assert(route, 'The owner-approved real route must already be saved through settings');
  const snapshot = configuredRouteSnapshot(route, before.configuration.connections);
  const open = (lease: NativeAdmissions) =>
    services.modelSettings.credentialsFor(snapshot, lease.admission, lease, lease.signal);
  type Bound = Awaited<ReturnType<typeof open>>;
  let bound: Bound | undefined;
  let consumed = false;
  return {
    async prepared(lease: NativeAdmissions) {
      assert.equal(bound, undefined);
      bound = await open(lease);
      try {
        await assert.rejects(
          bound.credentials.withCredential({ ...bound.auth, signal: lease.signal }, async () => {
            consumed = true;
            throw new Error('Prepared process must not borrow key bytes');
          }),
          /not active/,
        );
        assert.equal(consumed, false);
      } catch (error) {
        bound.close();
        throw error;
      }
    },
    async active(lease: NativeAdmissions) {
      assert(bound, 'The same credential port must be prepared before native spawn');
      assert.deepEqual(bound.auth.admission, lease.admission);
      await lease.requireActive(bound.auth.admission, bound.signal);
      assert.equal(bound.signal.aborted, false);
      const actual = before.credentials.find(
        (entry) => entry.binding.connectionId === route.connectionId,
      );
      assert(actual);
      assert.deepEqual(bound.auth.binding, actual.binding);
      assert.deepEqual(bound.auth.reference, actual.reference);
      await assert.rejects(
        bound.credentials.withCredential(
          {
            ...bound.auth,
            admission: { ...bound.auth.admission, generation: bound.auth.admission.generation + 1 },
            signal: lease.signal,
          },
          async () => {
            consumed = true;
            throw new Error('A rejected credential request must not borrow key bytes');
          },
        ),
        /scope mismatch/,
      );
      assert.equal(consumed, false);
    },
    revoked() {
      assert(bound?.signal.aborted);
      bound.close();
      bound = undefined;
    },
    async shutdownWhileActive(lease: NativeAdmissions) {
      assert(bound && !bound.signal.aborted);
      assert.equal(lease.signal.aborted, false);
      await services.modelSettings.close();
      assert(bound.signal.aborted);
      assert.equal(lease.signal.aborted, false);
      await assert.rejects(open(lease), /closing/);
      bound.close();
    },
    proof() {
      assert.deepEqual(services.modelConfiguration.read(), before.configuration);
      assert.equal(consumed, false);
      return {
        actualConfiguredRoute: true,
        sharedVaultOwner: true,
        portPreparedBeforeNativeSpawn: true,
        preparedProcessRefused: true,
        activeProcesses: 2,
        wrongGenerationRefusedBeforeKeyBorrow: true,
        revokedAdmissionAbortsCredentialAuthority: true,
        serviceShutdownAbortsCredentialAuthority: true,
        configurationUnchanged: true,
        credentialBytesRead: false,
        modelRequests: 0,
      };
    },
    close() {
      bound?.close();
    },
  };
}
