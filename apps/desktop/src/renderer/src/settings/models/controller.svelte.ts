import { t } from '@skaro/ui';
import type { Connection, Route } from '@skaro/timeline';
import type { ModelSettingsSnapshot } from '../../../../shared/model-settings';

export function createModelSettingsController() {
  let snapshot = $state<ModelSettingsSnapshot>();
  let loading = $state(true),
    busy = $state(false),
    error = $state('');
  let connection = $state<Connection | 'new'>();
  let route = $state<Route | 'new'>();
  let removal = $state<{ kind: 'connection' | 'route'; id: string }>();
  let generation = 0;
  const load = async () => {
    const current = ++generation;
    loading = true;
    error = '';
    try {
      const value = await window.skaro.invoke('models.settings');
      if (generation === current) snapshot = value;
    } catch {
      if (generation === current) error = t('models.error');
    } finally {
      if (generation === current) loading = false;
    }
  };
  const run = async (action: (revision: number) => Promise<unknown>) => {
    if (busy || !snapshot) return false;
    busy = true;
    error = '';
    try {
      await action(snapshot.configuration.revision);
      await load();
      return !error;
    } catch {
      error = t('models.error');
      return false;
    } finally {
      busy = false;
    }
  };
  $effect(() => {
    void load();
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
    get busy() {
      return busy;
    },
    get error() {
      return error;
    },
    get connection() {
      return connection;
    },
    set connection(value) {
      connection = value;
    },
    get route() {
      return route;
    },
    set route(value) {
      route = value;
    },
    get removal() {
      return removal;
    },
    set removal(value) {
      removal = value;
    },
    load,
    saveConnection: async (draft: Omit<Connection, 'credential'>, secret?: string) => {
      if (
        await run((revision) =>
          window.skaro.invoke('models.saveConnection', revision, $state.snapshot(draft), secret),
        )
      )
        connection = undefined;
    },
    saveRoute: async (draft: Route) => {
      if (
        await run((revision) =>
          window.skaro.invoke('models.saveRoute', revision, $state.snapshot(draft)),
        )
      )
        route = undefined;
    },
    remove: async (value = removal) => {
      removal = undefined;
      if (value)
        await run((revision) =>
          window.skaro.invoke('models.remove', revision, value.kind, value.id),
        );
    },
  };
}
export type ModelSettingsController = ReturnType<typeof createModelSettingsController>;
