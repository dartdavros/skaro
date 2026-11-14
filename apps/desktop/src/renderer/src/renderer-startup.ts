import { setAgentCatalog } from '@skaro/agents/catalog';
import type { ShutdownState } from '../../shared/shutdown';
import { bootstrap, loadBootstrap } from './bootstrap';

/** Exit presentation must not wait for a catalog whose main-process services are still starting. */
export async function prepareRenderer(): Promise<void> {
  let pendingShutdown: ShutdownState | undefined;
  let release!: () => void;
  const closing = new Promise<void>((resolve) => (release = resolve));
  const off = window.skaro.on('app.shutdown', (state) => {
    pendingShutdown = state;
    if (bootstrap) bootstrap.shutdown = state;
    release();
  });
  try {
    const catalog = import.meta.env.SKARO_AGENT_CATALOG
      ? Promise.resolve(setAgentCatalog(import.meta.env.SKARO_AGENT_CATALOG))
      : window.skaro.invoke('agents.catalog').then(setAgentCatalog);
    // Attach both outcomes immediately, even if shutdown wins while bootstrap is loading.
    const ready = Promise.race([catalog, closing]);
    void ready.catch(() => undefined);
    await loadBootstrap();
    if (pendingShutdown && bootstrap) bootstrap.shutdown = pendingShutdown;
    if (!bootstrap?.shutdown) await ready;
  } finally {
    off();
  }
}
