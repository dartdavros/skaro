import type { BuiltinModelSettingsService } from './builtin-model-settings-service';

/** Configured credential binding only; never claims provider inference readiness. */
export function configuredBuiltinConnection(
  state: Awaited<ReturnType<BuiltinModelSettingsService['read']>>,
  id: string,
) {
  const connection = state.configuration.connections.find((entry) => entry.id === id);
  return (
    state.protection.state === 'available' &&
    !!connection &&
    state.credentials.some(
      (entry) =>
        entry.binding.connectionId === connection.id &&
        entry.binding.connectionRevision === connection.revision &&
        entry.binding.endpoint === connection.endpoint &&
        entry.reference.id === connection.credential.id &&
        entry.reference.revision === connection.credential.revision,
    )
  );
}
