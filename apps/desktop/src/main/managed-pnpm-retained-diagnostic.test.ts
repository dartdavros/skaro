import { AppDb } from '@skaro/core';
import { createHash } from 'node:crypto';
import { readFile, lstat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { expect, it } from 'vitest';
import { ManagedCacheStore } from './managed-cache-store';
import { cacheTree } from './managed-cache-files';
import { pnpmNodeModules } from './managed-pnpm-layout';
import { readManagedPnpmInput } from './managed-pnpm-provenance';
import { readPnpmGraphFacts } from './managed-pnpm-graph-facts';
import { CACHE_VERIFICATION_OWNER_SCOPE as scope } from './verification/cache-verification-scope';

// Non-authoritative reading of ACTUAL sixth residue. NEVER replace entry.installTarget or delete it.
it.skipIf(!process.env.SKARO_PNPM_RETAINED_GRAPH_DIAGNOSTIC_DATA)(
  'diagnoses actual sixth installed graph without adopting its replacement root',
  async () => {
    const data = resolve(process.env.SKARO_PNPM_RETAINED_GRAPH_DIAGNOSTIC_DATA!);
    const intent = 'dec8f960-57e1-48eb-ac7b-2eb2c5089c43';
    const proofBytes = await readFile(
      join(data, 'verification', `cache-workflow-${intent}`, 'proof.json'),
    );
    expect(createHash('sha256').update(proofBytes).digest('hex')).toBe(
      '08f81b618e6fdce8ac88c5129cdb66628e5395b5896f267b45de92dbc16789ad',
    );
    const proof = JSON.parse(proofBytes.toString());
    expect(proof.passed).toBe(false);
    expect(proof.error).toContain('managed_pnpm_target_identity_changed');
    const db = AppDb.readOnly(join(data, 'skaro.db'));
    try {
      db.shell.scopeTo(scope.projectId);
      const store = new ManagedCacheStore(db, data);
      const entries = store.artifacts();
      expect(entries).toHaveLength(1);
      const entry = entries[0]!;
      expect(entry.key).toBe('102fa58971c4f254c22bceffde0ef3633f76d495eec918875631604069290a97');
      expect(entry.consumer?.intent).toBe(intent);
      expect(entry.state).toBe('retained');
      expect(entry.immutable).toBe(false);
      expect(entry.digest).toBe('03d61d409d764e2aef1e8f6583520b2c3bac23fe39e139c2cc4e7effaff643bb');
      const target = entry.installTarget!;
      const before = await lstat(target.path, { bigint: true });
      expect(before.isDirectory()).toBe(true);
      expect(before.ino.toString()).toBe('13229323905476734');
      expect(before.birthtimeNs.toString()).toBe('1794518654652054800');
      expect(Number.isSafeInteger(target.ino)).toBe(false);
      expect(Number(before.birthtimeNs) / 1e6).not.toBe(target.birthtimeMs);
      const snapshot = JSON.stringify(entry);
      const input = await readManagedPnpmInput(join(scope.root, scope.dependencies));
      const artifact = store.path(entry.key);
      expect((await cacheTree(store.root, artifact)).digest).toBe(entry.digest);
      const facts = await readPnpmGraphFacts(store.root, artifact, input.lock);
      // The original capability remains unusable. Reading without it is NOT ownership/admission evidence.
      await expect(pnpmNodeModules(dirname(target.path), target.path, target)).rejects.toThrow();
      const observed = await pnpmNodeModules(dirname(target.path), target.path, undefined, {
        lock: input.lock,
        facts,
      });
      expect(observed.nodes.size).toBeGreaterThan(0);
      expect(observed.bytes).toBeGreaterThan(0);
      expect(JSON.stringify(store.artifacts()[0])).toBe(snapshot);
      const after = await lstat(target.path, { bigint: true });
      expect([after.dev, after.ino, after.birthtimeNs]).toEqual([
        before.dev,
        before.ino,
        before.birthtimeNs,
      ]);
      expect((await cacheTree(store.root, artifact)).digest).toBe(entry.digest);
    } finally {
      db.close();
    }
  },
  600000,
);
