import assert from 'node:assert/strict';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, sep } from 'node:path';
import { planPayloadHash } from './model-plan-request';
import type { ReviewedConfiguredPlan } from './configured-plan-payload';

/** Read exactly reviewed local bytes. Does not imply permission, readiness or a live budget grant. */
export async function readConfiguredPlanPacket(data: string, path: string, hash: string) {
  assert(/^[a-f0-9]{64}$/.test(hash));
  const root = await realpath(join(data, 'verification'));
  const actual = await realpath(path);
  const rel = relative(root, actual);
  const stat = await lstat(path);
  assert(rel && !isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`));
  assert(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 && stat.size <= 131_072);
  const reviewed = JSON.parse(await readFile(actual, 'utf8')) as ReviewedConfiguredPlan;
  assert.equal(planPayloadHash(reviewed), hash);
  assert(/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(reviewed.attemptId));
  return reviewed;
}
