import {
  RECONCILIATION_UNIQUE_METHOD,
  RECONCILIATION_UNIQUE_PHASE,
  uniqueReconciliationEntry,
} from './cache-verification-reconciliation-unique';
import { validUniqueReconciliationAccounting } from './cache-verification-reconciliation-unique-accounting';
import {
  replayFail as fail,
  replayKeys,
  type CacheReconciliationJournal,
} from './cache-verification-reconciliation-replay-types';

/** New tagged complete seam only. Legacy journals/counters never flow through this validator. */
export function assertUniqueReconciliationEvidence(journal: CacheReconciliationJournal) {
  const { evidence, original, trees } = journal,
    accounting = evidence.accounting;
  if (
    journal.version !== 2 ||
    !uniqueReconciliationEntry(original.entry) ||
    evidence.phase !== RECONCILIATION_UNIQUE_PHASE ||
    accounting?.method !== RECONCILIATION_UNIQUE_METHOD
  )
    return fail('unique_phase_binding');
  replayKeys(accounting, [
    'method',
    'complete',
    'completedTarballs',
    'expandedBytes',
    'expandedFiles',
    'payloadBytes',
    'shimFiles',
    'shimBytes',
    'metadataFiles',
  ]);
  if (
    !validUniqueReconciliationAccounting(
      accounting,
      evidence.downloadedTarballs.length,
      evidence.unjournaledDownloadBytes,
    ) ||
    accounting.expandedBytes !== original.entry.expandedBytes ||
    accounting.expandedFiles !== original.entry.expandedFiles ||
    evidence.physicalBytes !== evidence.journaledBytes ||
    trees.artifact.bytes !== original.entry.bytes ||
    !trees.artifact.files.some((file) => file.path === 'pnpm.tgz' && file.bytes > 0) ||
    trees.artifact.files.some(
      (file) =>
        file.path !== 'pnpm.tgz' &&
        !file.path.startsWith('runtime/') &&
        !/^tarballs\/[a-f0-9]{128}\.tgz$/.test(file.path),
    ) ||
    trees.artifact.directories.some(
      (path) => !['', 'runtime', 'tarballs'].includes(path) && !path.startsWith('runtime/'),
    )
  )
    fail('unique_complete_accounting');
}
