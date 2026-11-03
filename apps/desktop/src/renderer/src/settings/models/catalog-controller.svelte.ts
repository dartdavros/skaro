import type { Connection } from '@skaro/timeline';
import type { ModelCatalogSnapshot } from '../../../../shared/model-catalog';

export function createModelCatalogController(connection: () => Connection | undefined) {
  let snapshot = $state<ModelCatalogSnapshot>();
  let loading = $state(false),
    error = $state(false);
  let generation = 0;
  const load = async (id: string, revision: number, refresh = false) => {
    const current = ++generation;
    loading = true;
    error = false;
    try {
      const value = await window.skaro.invoke('models.catalog', id, revision, refresh);
      if (generation === current) snapshot = value;
    } catch {
      if (generation === current) {
        snapshot = undefined;
        error = true;
      }
    } finally {
      if (generation === current) loading = false;
    }
  };
  $effect(() => {
    const current = connection();
    snapshot = undefined;
    if (current) void load(current.id, current.revision);
    return () => {
      generation++;
    };
  });
  return {
    get snapshot() {
      return snapshot;
    },
    get loading() {
      return loading;
    },
    get error() {
      return error;
    },
    refresh() {
      const current = connection();
      if (current && !loading) void load(current.id, current.revision, true);
    },
  };
}
