import { AppDb } from '@skaro/core';
import { join, resolve } from 'node:path';
import { expect, it } from 'vitest';
import { CACHE_VERIFICATION_OWNER_SCOPE as scope } from './cache-verification-scope';
import { readCacheReconciliationPlan } from './cache-verification-reconciliation-plan';
import { snapshotReplayPlan } from './cache-verification-reconciliation-replay-snapshot';
import {
  assertReplayJournal,
  replaySnapshotDigest,
} from './cache-verification-reconciliation-replay-schema';
import { inspectReplayJournal } from './cache-verification-reconciliation-replay-inspection';
import { readReplayDatabase } from './cache-verification-reconciliation-replay-authority';
import { loadCacheReconciliationJournal } from './cache-verification-reconciliation-journal';
import {
  reconciliationPriorJournals,
  verifyReconciliationProof,
} from './cache-verification-reconciliation-producer-proof';
import { reconciliationHash } from './cache-verification-reconciliation-layout';
import {
  RECONCILIATION_INITIALIZED_V3_ATTEMPT as attempt,
  RECONCILIATION_INITIALIZED_V3_PHASE,
  RECONCILIATION_INITIALIZED_PHASE,
  INITIALIZED_STORE_DIRECTORIES,
} from './cache-verification-reconciliation-initialized';
import type { ReconciliationJournalData } from './cache-verification-reconciliation-replay-types';

// Actual fifth residue ONLY. Read-only DB and captured real metadata; no fixtures/SDK/admission/effects.
it.skipIf(!process.env.SKARO_CACHE_INITIALIZED_V3_RECONCILIATION_DATA)(
  'preflights fifth config-v3 residue and preserves all four prior completed journals',
  async () => {
    const data = resolve(process.env.SKARO_CACHE_INITIALIZED_V3_RECONCILIATION_DATA!);
    const db = AppDb.readOnly(join(data, 'skaro.db'));
    try {
      db.shell.scopeTo(scope.projectId);
      const prior = reconciliationPriorJournals(db);
      expect(prior).toHaveLength(4);
      const intents = [
        '5c22df0b-7bbb-42e0-b173-5de72efad0ac',
        'e4d8d85e-9c07-4daa-b039-ef4d6d540c35',
        'a316594d-37b4-4863-b107-ac40437ac9a9',
        '4184d324-e8da-4846-acd6-9fcfb380a85b',
      ];
      const completed = intents.map((intent) => loadCacheReconciliationJournal(db, intent));
      for (const journal of completed) expect(journal?.state).toBe('complete');
      expect(prior.find((row) => row.key.endsWith(`${intents[3]}.v2`))?.digest).toBe(
        '470fea42a034060b06423dbeaf48929ba471161f9b806f764fe21ad3947adefa',
      );
      expect(completed[3]?.producerProof?.digest).toBe(
        '7212115ac35b1f00eb1f079e769842eeb5c5970257def98510dc1c1167e605ec',
      );
      await verifyReconciliationProof(data, completed[3]!.producerProof!);
      expect(loadCacheReconciliationJournal(db, attempt.intentId)).toBeUndefined();
      const plan = await readCacheReconciliationPlan(db, data, attempt.intentId);
      expect(plan.producerProof.digest).toBe(attempt.producerDigest);
      expect(plan.trees.phase).toBe(RECONCILIATION_INITIALIZED_V3_PHASE);
      expect(plan.attempt.pid).toBe(attempt.pid);
      expect(plan.attempt.birth).toBe(attempt.birth);
      expect(plan.trees.artifact.bytes).toBe(attempt.bytes);
      expect(plan.trees.artifact.files).toHaveLength(1165);
      expect(plan.trees.artifact.directories.filter((path) => path.startsWith('store'))).toEqual(
        INITIALIZED_STORE_DIRECTORIES,
      );
      expect(plan.trees.artifact.files.some((file) => file.path.startsWith('store/'))).toBe(false);
      expect(plan.trees.scratch.directories).toEqual(['', 'home', 'node_modules']);
      expect(plan.trees.accounting).toMatchObject({
        complete: true,
        completedTarballs: 52,
        expandedBytes: attempt.expandedBytes,
        expandedFiles: attempt.expandedFiles,
      });
      const journal = snapshotReplayPlan(plan);
      assertReplayJournal(journal);
      const before = readReplayDatabase(db, data, journal);
      expect(await inspectReplayJournal(db, data, journal)).toEqual({
        settled: false,
        originalsReleased: false,
        metadataAbsent: false,
      });
      const reject = (change: (copy: ReconciliationJournalData) => void) => {
        const copy = JSON.parse(JSON.stringify(journal)) as ReconciliationJournalData;
        change(copy);
        for (const tree of Object.values(copy.trees))
          Object.assign(tree, { digest: reconciliationHash(JSON.stringify(tree.files)) });
        copy.snapshotDigest = replaySnapshotDigest(copy);
        expect(() => assertReplayJournal(copy)).toThrow();
      };
      reject((copy) => {
        Object.assign(copy.evidence, { phase: RECONCILIATION_INITIALIZED_PHASE });
      });
      reject((copy) => {
        Object.assign(copy.producerProof!, { digest: completed[3]!.producerProof!.digest });
      });
      reject((copy) => {
        Object.assign(copy.original.entry, { generation: 2 });
      });
      reject((copy) => {
        Object.assign(copy.original.sourceLease, { revision: 4 });
      });
      reject((copy) => {
        Object.assign(copy.trees.artifact, {
          directories: [...copy.trees.artifact.directories, 'store/v10/unknown'].sort(),
        });
      });
      reject((copy) => {
        Object.assign(
          copy.trees.artifact.files.find((file) => file.path === 'pnpm-graph.json')!,
          { digest: '0'.repeat(64) },
        );
      });
      reject((copy) => {
        Object.assign(copy.original.entry.installTarget!, {
          ino: copy.original.entry.installTarget!.ino + 1,
        });
      });
      expect(readReplayDatabase(db, data, journal)).toEqual(before);
      expect(reconciliationPriorJournals(db)).toEqual(prior);
      expect(intents.map((intent) => loadCacheReconciliationJournal(db, intent))).toEqual(
        completed,
      );
      await plan.requireUnchanged();
    } finally {
      db.close();
    }
  },
  600000,
);
