import { isDeepStrictEqual } from 'node:util';
import { chatToolEvidence, readRuntimeJournal } from '@skaro/agent-runtime';
import { configuredRouteSnapshot } from '@skaro/timeline';
import type { BuiltinModelConfigurationStore } from './builtin-model-configuration';

/** Main-only observation. No renderer-supplied path, persisted readiness or permission to run. */
export async function readConfiguredToolEvidence(
  store: BuiltinModelConfigurationStore,
  source: Parameters<typeof chatToolEvidence>[1] & { journalPath: string },
  signal: AbortSignal,
) {
  const input = structuredClone(source);
  const requireCurrent = () => {
    signal.throwIfAborted();
    const configuration = store.read();
    const route = configuration.routes.find((entry) => entry.id === input.route.routeId);
    if (
      !route ||
      !isDeepStrictEqual(configuredRouteSnapshot(route, configuration.connections), input.route)
    )
      throw new Error('Tool evidence route is unavailable or no longer current');
  };
  requireCurrent();
  const journal = await readRuntimeJournal(input.journalPath, input.sessionId);
  requireCurrent();
  const evidence = chatToolEvidence(journal.records, input);
  requireCurrent();
  return evidence;
}
