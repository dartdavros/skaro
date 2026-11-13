import { AppDb } from '@skaro/core';
import { join, resolve } from 'node:path';
import { expect, it } from 'vitest';
import { ManagedCacheStore } from '../managed-cache-store';
import { CACHE_VERIFICATION_OWNER_SCOPE as scope } from './cache-verification-scope';
import { readCacheReconciliationPlan } from './cache-verification-reconciliation-plan';
import {
  readReconciliationLayout,
  freezeReconciliation,
  reconciliationHash,
} from './cache-verification-reconciliation-layout';
import { readUniqueReconciliationLayout } from './cache-verification-reconciliation-unique-layout';
import { snapshotReplayPlan } from './cache-verification-reconciliation-replay-snapshot';
import {
  assertReplayJournal,
  replaySnapshotDigest,
} from './cache-verification-reconciliation-replay-schema';
import { inspectReplayJournal } from './cache-verification-reconciliation-replay-inspection';
import { readReplayDatabase } from './cache-verification-reconciliation-replay-authority';
import { loadCacheReconciliationJournal } from './cache-verification-reconciliation-journal';
import {
  verifyReconciliationProof,
  reconciliationPriorJournals,
} from './cache-verification-reconciliation-producer-proof';
import {
  RECONCILIATION_INITIALIZED_ATTEMPT as attempt,
  RECONCILIATION_INITIALIZED_PHASE,
  INITIALIZED_STORE_DIRECTORIES,
} from './cache-verification-reconciliation-initialized';
import { RECONCILIATION_UNIQUE_PHASE } from './cache-verification-reconciliation-unique';
import type { ReconciliationJournalData } from './cache-verification-reconciliation-replay-types';

// Actual fourth attempt ONLY. Opt-in read-only DB; no fixtures, mocks, SDK, admission or effects.
it.skipIf(!process.env.SKARO_CACHE_INITIALIZED_RECONCILIATION_DATA)(
  'preflights the actual fourth graph/initialized-empty-store failure and all existing native/ledger gates',
  async () => {
    const data = resolve(process.env.SKARO_CACHE_INITIALIZED_RECONCILIATION_DATA!);
    const db = AppDb.readOnly(join(data, 'skaro.db'));
    try {
      db.shell.scopeTo(scope.projectId);
      const prior = reconciliationPriorJournals(db);
      const historicalIntents = [
        '5c22df0b-7bbb-42e0-b173-5de72efad0ac',
        'e4d8d85e-9c07-4daa-b039-ef4d6d540c35',
        'a316594d-37b4-4863-b107-ac40437ac9a9',
      ];
      const completed = historicalIntents.map((intent) =>
        loadCacheReconciliationJournal(db, intent),
      );
      for (const journal of completed) expect(journal?.state).toBe('complete');
      expect(completed[2]?.producerProof?.digest).toBe(
        'dfbbe9632f4e60378cabddd290db99cd5bf33ead1ba62eddb9ef1dcf8b043103',
      );
      if (completed[2]?.producerProof)
        await verifyReconciliationProof(data, completed[2].producerProof);
      expect(loadCacheReconciliationJournal(db, attempt.intentId)).toBeUndefined();
      // Production read-only plan independently proves absence/native source and exact retained originals.
      const plan = await readCacheReconciliationPlan(db, data, attempt.intentId);
      expect(plan.producerProof.digest).toBe(attempt.producerDigest);
      expect(plan.attempt.pid).toBe(attempt.pid);
      expect(plan.attempt.birth).toBe(attempt.birth);
      expect(plan.trees.phase).toBe(RECONCILIATION_INITIALIZED_PHASE);
      expect(plan.trees.accounting).toEqual({
        method: 'pnpm-isolated-unique-nodes-v2-complete',
        complete: true,
        completedTarballs: 52,
        expandedBytes: 9468521,
        expandedFiles: 1925,
        payloadBytes: 8878697,
        shimFiles: 9,
        shimBytes: 589824,
        metadataFiles: 3,
      });
      expect(plan.trees.artifact.bytes).toBe(25433204);
      expect(plan.trees.artifact.files).toHaveLength(1165);
      expect(plan.trees.artifact.directories).toHaveLength(761);
      expect(plan.trees.artifact.files.some((file) => file.path.startsWith('store/'))).toBe(false);
      expect(plan.trees.artifact.directories.filter((path) => path.startsWith('store'))).toEqual(
        INITIALIZED_STORE_DIRECTORIES,
      );
      expect(plan.trees.stage.files.map((file) => file.path)).toEqual([
        'package.json',
        'pnpm-lock.yaml',
      ]);
      expect(plan.trees.scratch.directories).toEqual(['', 'home', 'node_modules']);
      expect(plan.trees.unjournaledDownloadBytes).toBe(0);
      const journal = freezeReconciliation(snapshotReplayPlan(plan));
      assertReplayJournal(journal);
      const before = readReplayDatabase(db, data, journal);
      expect(await inspectReplayJournal(db, data, journal)).toEqual({
        settled: false,
        originalsReleased: false,
        metadataAbsent: false,
      });
      // The new files must NOT become accepted by either historical layout seam.
      const store = new ManagedCacheStore(db, data);
      const args = [
        store,
        plan.entry,
        plan.stagePath,
        plan.attempt.inputVersion,
        join(scope.root, scope.dependencies),
      ] as const;
      await expect(readUniqueReconciliationLayout(...args, 'prefetch-command')).rejects.toThrow(
        'artifact_phase_unknown',
      );
      await expect(readReconciliationLayout(...args, 'archive-expansion')).rejects.toThrow(
        'legacy_publication_required',
      );
      // Mutate captured ACTUAL metadata only, not fabricated domain evidence or fixture trees.
      const reject = (change: (copy: ReconciliationJournalData) => void) => {
        const copy = JSON.parse(JSON.stringify(journal)) as ReconciliationJournalData;
        change(copy);
        for (const tree of Object.values(copy.trees))
          Object.assign(tree, { digest: reconciliationHash(JSON.stringify(tree.files)) });
        copy.snapshotDigest = replaySnapshotDigest(copy);
        expect(() => assertReplayJournal(copy)).toThrow();
      };
      reject((copy) => {
        Object.assign(copy.evidence, { phase: RECONCILIATION_UNIQUE_PHASE });
      });
      reject((copy) => {
        Object.assign(copy.original.entry, { key: '0'.repeat(64) });
      });
      reject((copy) => {
        Object.assign(copy.original.sourceLease, { revision: 4 });
      });
      reject((copy) => {
        copy.producerProof!.digest = '0'.repeat(64);
      });
      reject((copy) => {
        Object.assign(copy.evidence, { unjournaledDownloadBytes: 1 });
      });
      reject((copy) => {
        Object.assign(copy.evidence.accounting!, { pending: {} });
      });
      reject((copy) => {
        Object.assign(copy.evidence.accounting!, { completedTarballs: 51 });
      });
      reject((copy) => {
        Object.assign(copy.trees.artifact, {
          directories: copy.trees.artifact.directories.filter(
            (path) => path !== 'store/v10/index/ff',
          ),
        });
      });
      reject((copy) => {
        Object.assign(copy.trees.artifact, {
          directories: [...copy.trees.artifact.directories, 'store/v10/files/00/unknown'].sort(),
        });
      });
      reject((copy) => {
        const graph = copy.trees.artifact.files.find((file) => file.path === 'pnpm-graph.json')!;
        Object.assign(graph, { digest: '0'.repeat(64) });
      });
      reject((copy) => {
        const file = copy.trees.artifact.files.find((file) => file.path.startsWith('tarballs/'))!;
        Object.assign(file, { path: 'store/v10/files/00/unknown' });
      });
      reject((copy) => {
        const file = copy.trees.artifact.identities.find((node) => !node.directory)!;
        Object.assign(file, { nlink: 2 });
      });
      reject((copy) => {
        Object.assign(copy.original.entry.installTarget!, {
          ino: copy.original.entry.installTarget!.ino + 1,
        });
      });
      reject((copy) => {
        Object.assign(copy.trees.scratch, { directories: ['', 'home'] });
      });
      expect(readReplayDatabase(db, data, journal)).toEqual(before);
      expect(reconciliationPriorJournals(db)).toEqual(prior);
      expect(historicalIntents.map((intent) => loadCacheReconciliationJournal(db, intent))).toEqual(
        completed,
      );
      await plan.requireUnchanged();
    } finally {
      db.close();
    }
  },
  300000,
);
