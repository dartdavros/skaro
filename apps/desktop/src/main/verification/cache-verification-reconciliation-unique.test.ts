import { expect, it } from 'vitest';
import { NPM_INSTALL_FILE_LIMIT } from '../managed-npm-archive';
import {
  validUniqueReconciliationAccounting,
  type UniqueReconciliationAccounting,
} from './cache-verification-reconciliation-unique-accounting';
import { RECONCILIATION_UNIQUE_METHOD } from './cache-verification-reconciliation-unique';
import { uniqueReconciliationProducerFailure } from './cache-verification-reconciliation-unique-proof';

// Pure arithmetic metadata only: no synthetic archive/tree/executor/domain receipt or grant.
const accounting: UniqueReconciliationAccounting = {
  method: RECONCILIATION_UNIQUE_METHOD,
  complete: true,
  completedTarballs: 52,
  expandedBytes: 9468521,
  expandedFiles: 1925,
  payloadBytes: 8878697,
  shimFiles: 9,
  shimBytes: 589824,
  metadataFiles: 3,
};
it('requires complete unique accounting, exact shim reserve and zero physical/accounting delta', () => {
  const valid = (changes: Partial<UniqueReconciliationAccounting> = {}, delta = 0, count = 52) =>
    validUniqueReconciliationAccounting({ ...accounting, ...changes }, count, delta);
  expect(NPM_INSTALL_FILE_LIMIT).toBe(4096);
  expect(valid()).toBe(true);
  expect(valid({}, 1)).toBe(false);
  expect(valid({}, 0, 51)).toBe(false);
  expect(valid({ expandedFiles: 4097 })).toBe(false);
  expect(valid({ expandedBytes: accounting.expandedBytes + 1 })).toBe(false);
  expect(valid({ shimFiles: 8 })).toBe(false);
  expect(valid({ payloadBytes: -1 })).toBe(false);
  expect(valid({ expandedFiles: 1.5 })).toBe(false);
  const legacyField = { ...accounting, pending: undefined };
  expect(validUniqueReconciliationAccounting(legacyField, 52, 0)).toBe(false);
});
it('does not classify legacy overflow, unknown errors or completed operations as the generic command seam', () => {
  // Error/operation field classification only; successful producer receipts must come from actual files.
  expect(() =>
    uniqueReconciliationProducerFailure({
      error: 'Error: managed_dependencies_unsupported_archive_expansion\n',
      dependencyOperations: [],
    }),
  ).toThrow('unique_failed_producer_proof');
  expect(() =>
    uniqueReconciliationProducerFailure({
      error: 'Error: another_error\n',
      dependencyOperations: [],
    }),
  ).toThrow('unique_failed_producer_proof');
  expect(() =>
    uniqueReconciliationProducerFailure({
      error: 'Error: managed_cache_command_failed\n',
      dependencyOperations: ['completed'],
    }),
  ).toThrow('unique_failed_producer_proof');
});
