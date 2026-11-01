import assert from 'node:assert/strict';
import type { Services } from '../app-services';

/** Actual registry admission, no access to the excluded project's checkout or services. */
export function verifyProjectScope(services: Services) {
  const scope = services.db.shell.projectScope;
  assert(scope, 'Verification services require a project scope before startup');
  const projects = services.db.shell.list();
  assert.equal(projects.length, 1);
  assert.equal(projects[0]!.id, scope);
  assert.equal(projects[0]!.name.toLowerCase(), 'cat-pilot');
  const bootstrap = services.appState.bootstrap();
  assert.deepEqual(
    bootstrap.projects.map((project) => project.id),
    [scope],
  );
  assert.deepEqual(bootstrap.tabs, { projects: [scope], active: scope });
  assert.equal(bootstrap.workspace?.view, 'settings');
  assert.equal(bootstrap.sessions, undefined);
  assert.equal(services.db.shell.get('outside-verification-scope'), undefined);
  assert.throws(() => services.projects.get('outside-verification-scope'), /unknown project/);
  return {
    project: 'Cat-pilot',
    projectId: scope,
    registryScopedBeforeServices: true,
    restoredForeignTabs: 0,
    foreignHistoryRestored: false,
    unknownProjectRejectedBeforeCheckout: true,
    globalDockerPruneDisabled: true,
  };
}
