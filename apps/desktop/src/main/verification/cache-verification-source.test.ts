import { expect, it } from 'vitest';
import { join } from 'node:path';
import {
  CACHE_VERIFICATION_OWNER_SCOPE,
  cacheVerificationProject,
  openCacheVerificationDatabase,
} from './cache-verification-scope';
import { requireCacheVerificationSource } from './cache-verification-source';

it('does not accept serialized project/path/lease assertions as a host source capability', () => {
  expect(() =>
    requireCacheVerificationSource({
      ...CACHE_VERIFICATION_OWNER_SCOPE,
      resourceId: 'claimed',
      generation: 1,
      locks: [],
    }),
  ).toThrow('host_source_capability_required');
});
it.skipIf(process.env.SKARO_CACHE_REGISTERED_PROJECT_PREFLIGHT !== '1')(
  'reads the actual authorized registry/root without resetting tasks or writing a source registration',
  async () => {
    if (!process.env.APPDATA) throw new Error('Actual Windows application data is required');
    const db = await openCacheVerificationDatabase(join(process.env.APPDATA, 'Skaro'), true);
    try {
      const source = await cacheVerificationProject(db);
      expect(db.shell.list().map((project) => project.id)).toEqual([
        CACHE_VERIFICATION_OWNER_SCOPE.projectId,
      ]);
      expect(source.head).toMatch(/^[a-f0-9]{40}$/);
      await source.requireCurrent();
      console.info('Actual registered cache source, read-only', {
        projectId: source.projectId,
        root: source.root,
        head: source.head,
      });
    } finally {
      db.close();
    }
  },
  120000,
);
