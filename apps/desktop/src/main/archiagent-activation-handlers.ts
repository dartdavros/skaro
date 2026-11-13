import type { Services } from './app-services';
import type { Handlers } from './ipc';
import type { ArchiagentActivationMethods } from '../shared/archiagent-activation';
import { activationSnapshot } from './archiagent-activation-snapshot';
import { activateArchiagent } from './archiagent-activation';

/** Existing owner control surface; activation adds no new UI or delegated permission. */
export function archiagentActivationHandlers(
  s: Pick<Services, 'db' | 'c4'>,
): Pick<Handlers, keyof ArchiagentActivationMethods> {
  return {
    'archiagent.status': async (project) =>
      activationSnapshot(s.db, project, await s.c4.records(project)),
    'archiagent.activate': async (project, protocol, expected, requestId) => {
      const records = await s.c4.records(project);
      const readiness = activationSnapshot(s.db, project, records);
      if (!readiness.compatible) throw new Error(readiness.reason);
      return activateArchiagent(s.db, project, protocol, expected, requestId, records);
    },
  };
}
