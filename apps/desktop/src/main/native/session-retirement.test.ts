import { spawn } from 'node:child_process';
import { expect, it } from 'vitest';
import { AppDb } from '@skaro/core';
import { processBirth, stopOwnedProcess } from '@skaro/agent-runtime/process-identity';
import { NativeAdmissions } from './admissions';
import { AdmissionStore } from './admission-state';
import { retireNativeSession } from './session-retirement';
import type { NativeSessionLeaseOwner } from './session-lease';

for (const failure of ['host-close', 'host-timeout', 'cleanup'] as const)
  it(`confirms a real owned process exit despite ${failure} failure`, async () => {
    // Real SQLite admission + real OS child. No project/task/run, API or model reply is seeded.
    const db = AppDb.open(':memory:');
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      windowsHide: true,
      stdio: 'ignore',
    });
    let identity: { pid: number; birth: string; platform: NodeJS.Platform } | undefined;
    let owner: NativeSessionLeaseOwner | undefined;
    try {
      expect(child.pid).toBeGreaterThan(0);
      const birth = await processBirth(child.pid!);
      expect(birth).toBeDefined();
      identity = { pid: child.pid!, birth: birth!, platform: process.platform };
      const lease = await NativeAdmissions.prepare({
        db,
        ownerKey: 'retirement-metadata',
        sessionId: 'retirement-contract',
        scope: {
          kind: 'task',
          projectId: 'metadata-only',
          taskId: 'metadata-only',
          runId: 'metadata-only',
        },
        signal: new AbortController().signal,
        async requireCurrent(signal) {
          signal.throwIfAborted();
        },
      });
      await lease.admit(identity, new AbortController().signal);
      let cleanupRan = false,
        capturedCloserRan = false,
        replacementCloserRan = false;
      owner = {
        builtinAdmission: lease,
        async builtinClose() {
          capturedCloserRan = true;
          if (failure === 'host-close') throw new Error('host-close failure');
          if (failure === 'host-timeout') await new Promise<void>(() => undefined);
        },
      };
      const retired = retireNativeSession(owner, 'Local retirement contract', async () => {
        cleanupRan = true;
        expect(new AdmissionStore(db, 'retirement-metadata').read()?.status).toBe('revoked');
        if (failure === 'cleanup') throw new Error('cleanup failure');
        // The independent final confirmation must stop the actual owner even without this callback doing it.
      });
      owner.builtinClose = () => {
        replacementCloserRan = true;
      };
      await expect(retired).rejects.toThrow(
        failure === 'host-timeout' ? 'close deadline exceeded' : `${failure} failure`,
      );
      expect(cleanupRan && capturedCloserRan).toBe(true);
      expect(replacementCloserRan).toBe(false);
      expect(await processBirth(identity.pid)).not.toBe(identity.birth);
      expect(new AdmissionStore(db, 'retirement-metadata').read()?.status).toBe('exited');
      expect(owner.builtinAdmission).toBeUndefined();
      await expect(
        lease.requireActive(lease.admission, new AbortController().signal),
      ).rejects.toThrow();
      expect(db.listProjects()).toEqual([]);
      expect(db.listRuns('metadata-only')).toEqual([]);
    } finally {
      if (identity) await stopOwnedProcess(identity);
      else child.kill();
      if (owner?.builtinAdmission) {
        await owner.builtinAdmission.revoke(owner.builtinAdmission.admission, 'Test cleanup');
        await owner.builtinAdmission.confirmExit(owner.builtinAdmission.admission);
      }
      db.close();
    }
  }, 45000);
