import type { Handlers } from './ipc';
import type { TaskIncidents } from './task-incidents';
export function incidentHandlers(
  incidents: TaskIncidents,
): Pick<Handlers, keyof import('../shared/incidents').IncidentMethods> {
  return {
    'incidents.list': async (p) => incidents.store.list(p),
    'incidents.policy': async (p) => incidents.policy.read(p),
    'incidents.setPolicy': async (p, policy, expected) =>
      incidents.policy.save(p, policy, expected),
    'incidents.recheck': (p, id) => incidents.reconcile(p, id),
    'incidents.answer': (p, id, answer) => incidents.decisions.answer(p, id, answer),
    'incidents.revoke': (p, id) => incidents.decisions.revoke(p, id),
    'incidents.cancel': (p, id) => incidents.decisions.cancel(p, id),
  };
}
