import { AppDb, git } from '@skaro/core';
import { realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { selectManagedCacheContext } from '../managed-cache-context';

/** Owner's explicit exception is cache-only. Never generalize AppState/Cat-pilot or accept a worker cohort. */
export const CACHE_VERIFICATION_OWNER_SCOPE = Object.freeze({
  projectId: 'b1a0a1fc-5435-4b37-a30a-c2b3d6c06f1b',
  root: 'C:\\Users\\drmar\\Projects\\stolovka\\code',
  dependencies: 'gateway',
  build: 'backend',
});
const gitEnvironment = { GIT_NO_REPLACE_OBJECTS: '1', GIT_OPTIONAL_LOCKS: '0' };
export async function cacheVerificationProject(db: AppDb) {
  const owner = CACHE_VERIFICATION_OWNER_SCOPE;
  if (db.shell.projectScope !== owner.projectId)
    throw new Error('cache_verification_exact_owner_project_scope_required');
  const project = db.shell.get(owner.projectId);
  if (!project) throw new Error('cache_verification_registered_project_required');
  const root = await realpath(project.path);
  if (root !== (await realpath(owner.root)))
    throw new Error('cache_verification_owner_root_mismatch');
  const selected = await selectManagedCacheContext(root);
  const top = await git(root, ['rev-parse', '--show-toplevel'], { env: gitEnvironment });
  if ((await realpath(top.stdout.trim())) !== root)
    throw new Error('cache_verification_registered_main_checkout_required');
  const head = (
    await git(root, ['rev-parse', '--verify', 'HEAD^{commit}'], { env: gitEnvironment })
  ).stdout.trim();
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(head))
    throw new Error('cache_verification_head_invalid');
  return Object.freeze({
    projectId: owner.projectId,
    root,
    head,
    async requireCurrent() {
      const current = db.shell.get(owner.projectId);
      if (!current || (await realpath(current.path)) !== root)
        throw new Error('cache_verification_project_changed');
      await selected.requireCurrent();
      const actual = (
        await git(root, ['rev-parse', '--verify', 'HEAD^{commit}'], { env: gitEnvironment })
      ).stdout.trim();
      if (actual !== head) throw new Error('cache_verification_head_changed');
    },
  });
}
/** No AppState, resetStaleRuntime, createServices, indexing, task adoption or workflow recovery. */
export async function openCacheVerificationDatabase(
  data: string,
  readOnly = false,
): Promise<AppDb> {
  const path = join(data, 'skaro.db');
  let db: AppDb | undefined = AppDb.readOnly(path);
  try {
    db.shell.scopeTo(CACHE_VERIFICATION_OWNER_SCOPE.projectId);
    await cacheVerificationProject(db);
    if (readOnly) return db;
    if (
      db.admission
        .all()
        .some(
          (lease) =>
            lease.projectId === CACHE_VERIFICATION_OWNER_SCOPE.projectId &&
            !['released', 'cancelled', 'stopped_by_owner'].includes(lease.state),
        )
    )
      throw new Error('cache_verification_existing_owner_leases_retained');
    const registry = db;
    db = undefined;
    registry.close();
    db = AppDb.open(path);
    db.shell.scopeTo(CACHE_VERIFICATION_OWNER_SCOPE.projectId);
    await cacheVerificationProject(db);
    return db;
  } catch (error) {
    db?.close();
    throw error;
  }
}
