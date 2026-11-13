import { AppDb } from '@skaro/core';
import { join, resolve } from 'node:path';
import { expect, it } from 'vitest';
import { ManagedCacheStore } from '../managed-cache-store';
import { CACHE_VERIFICATION_OWNER_SCOPE as scope } from './cache-verification-scope';
import { discoverReconciliationSnapshot } from './cache-verification-reconciliation-discovery';
import {
  readReconciliationLayout,
  freezeReconciliation,
} from './cache-verification-reconciliation-layout';
import {
  readUniqueReconciliationLayout,
  requireReconciliationSourceInput,
} from './cache-verification-reconciliation-unique-layout';
import {
  readReconciliationProducerProof,
  reconciliationPriorJournals,
} from './cache-verification-reconciliation-producer-proof';
import {
  readPriorReconciliationProofs,
  verifyPreservedReconciliationProofs,
} from './cache-verification-reconciliation-preserved';
import { snapshotReplayPlan } from './cache-verification-reconciliation-replay-snapshot';
import {
  assertReplayJournal,
  replaySnapshotDigest,
} from './cache-verification-reconciliation-replay-schema';
import { reconciliationRemainder } from './cache-verification-reconciliation-replay-physical';
import { loadCacheReconciliationJournal } from './cache-verification-reconciliation-journal';
import { readReplayDatabase } from './cache-verification-reconciliation-replay-authority';
import { RECONCILIATION_UNIQUE_PHASE } from './cache-verification-reconciliation-unique';
import type { ReconciliationJournalData } from './cache-verification-reconciliation-replay-types';

// Actual owned dataset ONLY. No fixture, SDK/git/native subprocess, mock, write, admission or journal save.
it.skipIf(!process.env.SKARO_CACHE_UNIQUE_RECONCILIATION_DATA)(
  'proves all 52 actual archives, mirror, empty target and exact unique counters without effects',
  async () => {
    const data = resolve(process.env.SKARO_CACHE_UNIQUE_RECONCILIATION_DATA!);
    const intent = 'a316594d-37b4-4863-b107-ac40437ac9a9';
    const db = AppDb.readOnly(join(data, 'skaro.db'));
    try {
      db.shell.scopeTo(scope.projectId);
      const store = new ManagedCacheStore(db, data);
      const project = {
        projectId: scope.projectId,
        root: resolve(scope.root),
        head: 'f8ecfcf2ac53ebae686e81af7f0a7af12948224d',
      };
      const snapshot = discoverReconciliationSnapshot(db, store, project, intent, Date.now());
      const prior = reconciliationPriorJournals(db);
      const producer = await readReconciliationProducerProof(data, intent, project, snapshot);
      expect(producer.failure).toBe('prefetch-command');
      expect(producer.receipt.digest).toBe(
        'dfbbe9632f4e60378cabddd290db99cd5bf33ead1ba62eddb9ef1dcf8b043103',
      );
      const stagePath = join(store.root, 'verification-inputs', snapshot.attempt.inputDirectory);
      const trees = await readUniqueReconciliationLayout(
        store,
        snapshot.entry,
        stagePath,
        snapshot.attempt.inputVersion,
        join(scope.root, scope.dependencies),
        'prefetch-command',
      );
      expect(trees.phase).toBe(RECONCILIATION_UNIQUE_PHASE);
      expect(trees.accounting).toEqual({
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
      expect(trees.downloadedTarballs).toHaveLength(52);
      expect(trees.artifact.bytes).toBe(25427010);
      expect(trees.artifact.files).toHaveLength(1164);
      expect(trees.artifact.directories).toHaveLength(245);
      expect(trees.scratch.bytes).toBe(29453);
      expect(trees.scratch.directories).toEqual(['', 'home', 'node_modules']);
      expect(trees.stage.bytes).toBe(13907);
      expect(trees.unjournaledDownloadBytes).toBe(0);
      const preserved = {
        ...snapshot.preserved,
        proofs: await readPriorReconciliationProofs(data),
      };
      const journal = freezeReconciliation(
        snapshotReplayPlan({
          ...snapshot,
          storeRoot: store.root,
          project,
          trees,
          producerProof: producer.receipt,
          preserved,
        }),
      );
      assertReplayJournal(journal);
      const before = readReplayDatabase(db, data, journal);
      for (const role of ['artifact', 'scratch', 'stage'] as const)
        expect((await reconciliationRemainder(journal, role))?.bytes).toBe(trees[role].bytes);
      expect(() => loadCacheReconciliationJournal(db, intent)).not.toThrow();
      expect(loadCacheReconciliationJournal(db, intent)).toBeUndefined();
      expect(
        loadCacheReconciliationJournal(db, '5c22df0b-7bbb-42e0-b173-5de72efad0ac')?.state,
      ).toBe('complete');
      expect(
        loadCacheReconciliationJournal(db, 'e4d8d85e-9c07-4daa-b039-ef4d6d540c35')?.state,
      ).toBe('complete');
      await expect(
        readReconciliationLayout(
          store,
          snapshot.entry,
          stagePath,
          snapshot.attempt.inputVersion,
          join(scope.root, scope.dependencies),
          'archive-expansion',
        ),
      ).rejects.toThrow('legacy_publication_required');
      await expect(
        readReconciliationProducerProof(data, intent, project, { ...snapshot, entry: undefined }),
      ).rejects.toThrow('failed_producer_proof');
      await expect(
        requireReconciliationSourceInput(join(scope.root, scope.dependencies), '0'.repeat(64)),
      ).rejects.toThrow('current_source_input_changed');
      // Negative metadata mutations use ONLY the captured actual receipt, never invented domain evidence.
      const reject = (change: (copy: ReconciliationJournalData) => void) => {
        const copy = JSON.parse(JSON.stringify(journal)) as ReconciliationJournalData;
        change(copy);
        copy.snapshotDigest = replaySnapshotDigest(copy);
        expect(() => assertReplayJournal(copy)).toThrow();
      };
      reject((copy) => {
        Object.assign(copy.original.entry, { expansionPolicy: undefined });
      });
      reject((copy) => {
        Object.assign(copy.original.entry.installTarget!, {
          ino: copy.original.entry.installTarget!.ino + 1,
        });
      });
      reject((copy) => {
        Object.assign(copy.evidence, {
          phase: 'public-downloads-only-packaged-version-child-closed',
        });
      });
      reject((copy) => {
        Object.assign(copy.evidence, { unjournaledDownloadBytes: 1 });
      });
      reject((copy) => {
        Object.assign(copy.trees.scratch, { directories: ['', 'home'] });
      });
      reject((copy) => {
        Object.assign(copy.evidence.accounting!, { pending: {} });
      });
      expect(readReplayDatabase(db, data, journal)).toEqual(before);
      expect(reconciliationPriorJournals(db)).toEqual(prior);
      expect(prior.map((row) => row.digest).sort()).toEqual(
        [
          'ecec25af0a565373dd1fe1f9a50dd6affd827672973a1f38c0d88f80df4db3aa',
          'e6eb73bc68720c797b4079229115ce4e519c70551fff2d82af5bb52cd2662e3c',
        ].sort(),
      );
      await verifyPreservedReconciliationProofs(data, preserved.proofs);
      console.info('actual read-only unique reconciliation', {
        intent,
        accounting: trees.accounting,
        artifactBytes: trees.artifact.bytes,
        stageBytes: trees.stage.bytes,
        scratchBytes: trees.scratch.bytes,
        priorJournals: prior,
        preservedProofs: preserved.proofs,
      });
    } finally {
      db.close();
    }
  },
  300000,
);
