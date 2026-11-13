import { resourceId, type AppDb, type ResourceRegistration } from '@skaro/core';

type DiagnosticDb = Pick<AppDb, 'getSetting' | 'setSetting' | 'getProject' | 'addEvent'>;

export function reportDeferredEnvironment(
  db: DiagnosticDb,
  resource: ResourceRegistration,
  reason?: string,
): void {
  const id = resourceId(resource);
  const key = `resources.environmentDeferred.${id}`;
  const previous = db.getSetting<string>(key, '');
  if (previous === (reason ?? '')) return;
  if (db.getProject(resource.projectId))
    db.addEvent(resource.projectId, reason ? 'resource_retained' : 'resource_observed', {
      kind: 'environment',
      resourceId: id,
      composeProject: resource.identity.composeProject,
      reason: reason ?? 'ownership_verified',
    });
  db.setSetting(key, reason ?? '');
}

/** A corrupt registry has no trustworthy resource identity; report at the project level. */
export function reportEnvironmentRegistryFailure(
  db: Pick<AppDb, 'getSetting' | 'setSetting' | 'listProjects' | 'addEvent'>,
  projectScope?: string,
): void {
  for (const project of db.listProjects()) {
    if (projectScope && projectScope !== project.id) continue;
    const key = `resources.environmentRegistry.${project.id}`;
    if (db.getSetting<string>(key, '') === 'registry_invalid') continue;
    db.addEvent(project.id, 'resource_retained', {
      kind: 'environment',
      reason: 'registry_invalid',
    });
    db.setSetting(key, 'registry_invalid');
  }
}
