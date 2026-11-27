import type { GraphStatus } from '@skaro/core/graph-view';

/** A late close or status event from the previous view must not affect a reopened graph. */
export function connectGraph(projectId: string, onStatus: (status: GraphStatus) => void) {
  const token = crypto.randomUUID();
  const off = window.skaro.on('graph.changed', (status) => {
    if (status.token === token && status.projectId === projectId) onStatus(status);
  });
  return {
    open: () => window.skaro.invoke('graph.open', projectId, token),
    close: () => {
      off();
      void window.skaro.invoke('graph.close', token).catch(() => undefined);
    },
  };
}
