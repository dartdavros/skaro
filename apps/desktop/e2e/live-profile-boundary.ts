import { existsSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

/** A live run can persist UI state and recover sessions even before the first test action. */
export function assertLiveProfileBoundary(userData: string): void {
  const profiles = [
    process.env['SKARO_RESPONSIVENESS_PROFILE'],
    process.env['SKARO_STARTUP_USER_DATA'],
    process.env['SKARO_FOLLOW_UP_PROFILE'],
  ];
  if (!profiles.some((profile) => profile && resolve(profile) === resolve(userData))) return;
  const writable = process.env['SKARO_E2E_WRITE_PROJECT_ROOT'];
  if (!writable) throw new Error('Live checks require an explicitly isolated test project root');
  const root = realpathSync(writable);
  if (/(?:^|[\\/])chatballs(?:[\\/]|$)/i.test(root))
    throw new Error('Chatballs is read-only and cannot be used for live write checks');
  const file = join(userData, 'skaro.db');
  if (!existsSync(file)) return;
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const scope = process.env['SKARO_VERIFICATION_PROJECT'];
    if (scope) {
      const project = db.prepare('SELECT name,path FROM projects WHERE id=?').get(scope);
      if (
        !project ||
        String(project['name']).toLowerCase() !== 'cat-pilot' ||
        realpathSync(String(project['path'])) !== root
      )
        throw new Error('Scoped verification requires the registered Cat-pilot and its real root');
      return;
    }
    for (const project of db.prepare('SELECT id,name,path FROM projects').all()) {
      if (
        project['id'] === '70a06986-4881-4d6d-865c-fa6636fc00b4' ||
        String(project['name']).toLowerCase() === 'chatballs' ||
        realpathSync(String(project['path'])) !== root
      )
        throw new Error('The live profile contains a project outside the authorized test root');
    }
  } finally {
    db.close();
  }
}
