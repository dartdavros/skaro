import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { readRuntimeJournal } from '@skaro/agent-runtime';
import { processBirth } from '@skaro/agent-runtime/process-identity';
import { AdmissionStore } from '../native/admission-state';
import type { Services } from '../app-services';

export async function waitTaskStop<T>(
  label: string,
  read: () => T | undefined | Promise<T | undefined>,
) {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    const value = await read();
    if (value !== undefined) return value;
    await delay(100);
  }
  throw new Error(`Task Stop acceptance timed out: ${label}`);
}

export function taskAdmissionStore(services: Services, projectId: string, runId: string) {
  return new AdmissionStore(services.db, `task:${projectId}:T-006:${runId}`);
}

export async function requireTaskProcessExit(
  store: AdmissionStore,
  id: string,
  requireOwner = true,
) {
  const saved = store.read();
  assert.equal(saved?.admission.id, id);
  assert.equal(saved?.status, 'exited');
  if (requireOwner) assert(saved?.owner);
  if (saved?.owner) assert.notEqual(await processBirth(saved.owner.pid), saved.owner.birth);
  return saved;
}

/** A live writer can advance during a poll; only that explicit unstable-read error is retried. */
export async function observeTaskJournal(path: string, sessionId: string) {
  try {
    return await readRuntimeJournal(path, sessionId);
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === 'Model journal changed during inspection or has an incomplete tail'
    )
      return undefined;
    throw error;
  }
}
