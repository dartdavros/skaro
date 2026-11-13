import { c4RunProtocol, type AppDb, type C4Protocol, type C4ProtocolBinding } from '@skaro/core';
import { activationKey } from './archiagent-activation-state';

const projectKey = (project: string) => `c4.coordination.protocol.${project}`;
const runKey = (run: string) => `c4.coordination.run.${run}`;
export function projectC4Protocol(db: AppDb, project: string): C4Protocol {
  if (!db.getProject(project) || (db.shell.projectScope && db.shell.projectScope !== project))
    throw new Error('C4 protocol project is outside scope');
  const protocol = db.getSetting<C4Protocol>(projectKey(project), 'package-v1', { strict: true });
  if (!['package-v1', 'impact-v1'].includes(protocol))
    throw new Error('Unsupported C4 project protocol');
  return protocol;
}
export function taskC4Protocol(db: AppDb, project: string, run: string): C4Protocol {
  projectC4Protocol(db, project);
  const owner = db.getRun(run);
  if (!owner || owner.projectId !== project) throw new Error('C4 protocol run is outside scope');
  return c4RunProtocol(
    project,
    run,
    db.getSetting<C4ProtocolBinding | undefined>(runKey(run), undefined, { strict: true }),
  );
}
/** Only new runs select the project default; a handoff keeps its predecessor's contract. */
export function bindC4Protocol(
  db: AppDb,
  project: string,
  run: string,
  predecessor?: string,
  selected?: C4Protocol,
) {
  const protocol = predecessor
    ? taskC4Protocol(db, project, predecessor)
    : (selected ?? projectC4Protocol(db, project));
  const binding: C4ProtocolBinding = { projectId: project, runId: run, protocol };
  if (!db.settings.compareAndSet(runKey(run), undefined, binding)) {
    if (taskC4Protocol(db, project, run) !== protocol)
      throw new Error('C4 run protocol is immutable');
  }
  return binding;
}
export function selectC4Protocol(
  db: AppDb,
  project: string,
  protocol: C4Protocol,
  expected: C4Protocol,
) {
  const current = projectC4Protocol(db, project);
  if (db.getSetting(activationKey(project), undefined, { strict: true }) !== undefined)
    throw new Error('Managed activation requires the atomic archiagent activation barrier');
  if (current !== expected || !['package-v1', 'impact-v1'].includes(protocol))
    throw new Error('C4 protocol changed');
  const saved = db.getSetting<C4Protocol | undefined>(projectKey(project), undefined, {
    strict: true,
  });
  if (!db.settings.compareAndSet(projectKey(project), saved, protocol))
    throw new Error('C4 protocol changed');
  db.addEvent(project, 'c4_protocol_selected', {
    previous: current,
    protocol,
    existingRuns: 'unchanged',
  });
  return protocol;
}
