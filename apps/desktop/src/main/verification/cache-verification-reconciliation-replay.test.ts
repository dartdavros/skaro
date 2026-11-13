import { AppDb } from '@skaro/core';
import { join, resolve } from 'node:path';
import { expect, it } from 'vitest';
import { CACHE_VERIFICATION_OWNER_SCOPE } from './cache-verification-scope';
import { freezeReconciliation } from './cache-verification-reconciliation-layout';
import { readCacheReconciliationPlan } from './cache-verification-reconciliation-plan';
import {
  loadCacheReconciliationJournal,
  reconciliationRemainder,
} from './cache-verification-reconciliation-journal';
import { assertReplayJournal } from './cache-verification-reconciliation-replay-schema';
import {
  neverGrantedReconciliationAdmission,
  completedPreparedReconciliationTerminal,
  COMPLETED_RECONCILIATION_CONTROL_EVIDENCE,
} from './cache-verification-reconciliation-replay-lease';
import { snapshotReplayPlan } from './cache-verification-reconciliation-replay-snapshot';
import { validReconciliationAccountingSeam } from './cache-verification-reconciliation-accounting';
import { NPM_INSTALL_FILE_LIMIT } from '../managed-npm-archive';
import {
  reconciliationJournalKey,
  RECONCILIATION_JOURNAL_KEY,
} from './cache-verification-reconciliation-replay-types';
import { CACHE_RECONCILIATION_ATTEMPT } from './cache-verification-reconciliation-layout';
import { readReplayDatabase } from './cache-verification-reconciliation-replay-authority';
import { inspectReplayJournal } from './cache-verification-reconciliation-replay-inspection';

// Pure admission enum/metadata contracts, not manufactured leases, executors or domain receipts.
it('distinguishes denied/cancelled admission and waiting-owner abort from granted controller settlement', () => {
  expect(
    neverGrantedReconciliationAdmission({ state: 'cancelled', reason: 'budget_ramBytes' }),
  ).toBe(true);
  expect(
    neverGrantedReconciliationAdmission({ state: 'stopped_by_owner', reason: 'stopped_by_owner' }),
  ).toBe(true);
  expect(
    neverGrantedReconciliationAdmission({
      state: 'stopped_by_owner',
      reason: 'teardown_confirmed',
    }),
  ).toBe(false);
  expect(
    neverGrantedReconciliationAdmission({
      state: 'cancelled',
      reason: 'budget_ramBytes',
      evidence: '',
    }),
  ).toBe(false);
  expect(
    neverGrantedReconciliationAdmission({
      state: 'stopped_by_owner',
      reason: 'stopped_by_owner',
      evidence: 'present',
    }),
  ).toBe(false);
});
it('classifies crash-left waiters without claiming capacity, but never classifies a holder or released controller', () => {
  for (const state of ['waiting_resource', 'waiting_quota'] as const) {
    expect(neverGrantedReconciliationAdmission({ state, reason: 'queued' })).toBe(true);
    expect(neverGrantedReconciliationAdmission({ state, reason: 'queued', evidence: '' })).toBe(
      false,
    );
  }
  for (const state of ['granted', 'retained', 'released'] as const)
    expect(neverGrantedReconciliationAdmission({ state, reason: 'stopped_by_owner' })).toBe(false);
  expect(neverGrantedReconciliationAdmission({ state: 'cancelled', reason: '  ' })).toBe(false);
});

it('requires the exact prepared-control accounting evidence and four-step admission revision floor', () => {
  // Enum/field classification only: no lease, native/domain receipt or cleanup authority is created.
  const metadata = {
    state: 'stopped_by_owner' as const,
    reason: 'teardown_confirmed',
    evidence: COMPLETED_RECONCILIATION_CONTROL_EVIDENCE,
    revision: 4,
  };
  expect(completedPreparedReconciliationTerminal(metadata)).toBe(true);
  expect(completedPreparedReconciliationTerminal({ ...metadata, revision: 3 })).toBe(false);
  expect(completedPreparedReconciliationTerminal({ ...metadata, evidence: '' })).toBe(false);
  expect(
    completedPreparedReconciliationTerminal({
      ...metadata,
      evidence: `${metadata.evidence}:other`,
    }),
  ).toBe(false);
  expect(completedPreparedReconciliationTerminal({ ...metadata, reason: 'stopped_by_owner' })).toBe(
    false,
  );
  expect(completedPreparedReconciliationTerminal({ ...metadata, state: 'retained' })).toBe(false);
  expect(neverGrantedReconciliationAdmission(metadata)).toBe(false);
});

it('couples the two failed-publication counter seams without relaxing the 4096 publication bound', () => {
  // Arithmetic metadata only; no archive, lease, producer/native receipt or grant is fabricated.
  const aggregate = {
    expandedBytes: 1,
    expandedFiles: NPM_INSTALL_FILE_LIMIT - 1,
    pending: {
      failure: 'aggregate-expansion' as const,
      compressedBytes: 1,
      expandedBytes: 1,
      expandedFiles: 2,
    },
  };
  expect(NPM_INSTALL_FILE_LIMIT).toBe(4096);
  expect(validReconciliationAccountingSeam(aggregate, 0)).toBe(true);
  expect(validReconciliationAccountingSeam(aggregate, 1)).toBe(false);
  expect(
    validReconciliationAccountingSeam(
      { ...aggregate, pending: { ...aggregate.pending, expandedFiles: 1 } },
      0,
    ),
  ).toBe(false);
  expect(
    validReconciliationAccountingSeam(
      { ...aggregate, expandedFiles: NPM_INSTALL_FILE_LIMIT + 1 },
      0,
    ),
  ).toBe(false);
  const archive = {
    ...aggregate,
    pending: { failure: 'archive-expansion' as const, compressedBytes: 1 },
  };
  expect(validReconciliationAccountingSeam(archive, 1)).toBe(true);
  expect(validReconciliationAccountingSeam(archive, 0)).toBe(false);
  expect(
    validReconciliationAccountingSeam(
      { ...archive, pending: { ...archive.pending, expandedFiles: 2 } },
      1,
    ),
  ).toBe(false);
});
it('isolates journals by explicit intent while retaining the exact historical key and rejecting approval/path flags', () => {
  expect(reconciliationJournalKey(CACHE_RECONCILIATION_ATTEMPT.intentId)).toBe(
    RECONCILIATION_JOURNAL_KEY,
  );
  expect(reconciliationJournalKey(CACHE_VERIFICATION_OWNER_SCOPE.projectId)).not.toBe(
    RECONCILIATION_JOURNAL_KEY,
  );
  expect(() => reconciliationJournalKey('../escape')).toThrow('explicit_failed_intent_required');
  expect(() => reconciliationJournalKey('true')).toThrow('explicit_failed_intent_required');
});

// Actual selected failed attempt only. No fixture archives/trees, mutation, journal creation or admission.
it.skipIf(!process.env.SKARO_CACHE_RECONCILIATION_PREFLIGHT)(
  'reads and validates the original positive journal inventory, input pair digest and remaining native trees without effects',
  async () => {
    const data = resolve(process.env.SKARO_CACHE_RECONCILIATION_PREFLIGHT!),
      db = AppDb.readOnly(join(data, 'skaro.db'));
    try {
      db.shell.scopeTo(CACHE_VERIFICATION_OWNER_SCOPE.projectId);
      const failedIntent = process.env.SKARO_RC3_CACHE_FAILED_INTENT;
      const storedBefore = loadCacheReconciliationJournal(db, failedIntent),
        plan = await readCacheReconciliationPlan(db, data, failedIntent),
        journal = freezeReconciliation(snapshotReplayPlan(plan));
      assertReplayJournal(journal);
      expect(Object.isFrozen(journal.original.entry)).toBe(true);
      expect(Object.isFrozen(journal.trees.artifact.files)).toBe(true);
      const before = readReplayDatabase(db, data, journal);
      const [artifact, scratch, stage] = await Promise.all([
        reconciliationRemainder(journal, 'artifact'),
        reconciliationRemainder(journal, 'scratch'),
        reconciliationRemainder(journal, 'stage'),
      ]);
      expect(artifact?.bytes).toBe(plan.trees.artifact.bytes);
      expect(scratch?.bytes).toBe(plan.trees.scratch.bytes);
      expect(stage?.bytes).toBe(plan.trees.stage.bytes);
      expect(journal.evidence.unjournaledDownloadBytes).toBe(
        plan.trees.artifact.bytes - plan.entry.bytes,
      );
      expect(await inspectReplayJournal(db, data, journal)).toEqual({
        settled: false,
        originalsReleased: false,
        metadataAbsent: false,
      });
      expect(readReplayDatabase(db, data, journal)).toEqual(before);
      expect(loadCacheReconciliationJournal(db, failedIntent)).toEqual(storedBefore);
      console.info('actual read-only reconciliation inventory', {
        failedIntent: plan.attempt.intentId,
        generation: plan.entry.generation,
        accounting: journal.evidence.accounting,
        priorJournals: plan.preserved.journals,
        priorProofCount: plan.preserved.proofs.length,
        artifactBytes: artifact!.bytes,
        accountedBytes: plan.entry.bytes,
        unjournaledBytes: journal.evidence.unjournaledDownloadBytes,
        files: artifact!.files.length,
        directories: journal.trees.artifact.directories.length,
        stageBytes: stage!.bytes,
        scratchBytes: scratch!.bytes,
      });
    } finally {
      db.close();
    }
  },
  300000,
);
