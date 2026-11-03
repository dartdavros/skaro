import type { Handlers } from './ipc';
import type { ModelCatalogMethods } from '../shared/model-catalog';
import type { BuiltinModelCatalog } from './builtin-model-catalog';

export function modelCatalogHandlers(catalog: BuiltinModelCatalog) {
  return {
    'models.catalog': async (id, revision, refresh?: boolean) => {
      try {
        if (
          typeof id !== 'string' ||
          !/^[a-zA-Z0-9_-]{1,160}$/.test(id) ||
          !Number.isSafeInteger(revision) ||
          revision < 1 ||
          (refresh !== undefined && typeof refresh !== 'boolean')
        )
          throw new Error('Invalid catalog query');
        return await catalog.read(id, revision, refresh);
      } catch {
        throw new Error('MODEL_CATALOG_UNAVAILABLE');
      }
    },
  } satisfies Pick<Handlers, keyof ModelCatalogMethods>;
}
