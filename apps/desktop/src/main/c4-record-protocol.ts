import type { C4Protocol } from '@skaro/core';

/** Missing metadata belongs to the historical protocol; unknown metadata never does. */
export function c4RecordProtocol(record: { protocol?: unknown }): C4Protocol {
  if (record.protocol === undefined) return 'package-v1';
  if (record.protocol === 'package-v1' || record.protocol === 'impact-v1') return record.protocol;
  throw new Error('Unsupported persisted C4 protocol');
}
