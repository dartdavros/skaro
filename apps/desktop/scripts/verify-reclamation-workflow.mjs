import assert from 'node:assert/strict';
import { verifyDesktopWorkflow } from './verify-desktop-workflow.mjs';

// This workflow can remove a real completed checkout. Invocation alone is not deletion consent.
assert.equal(
  process.env.SKARO_RC3_CLEANUP_TASK,
  'T-005',
  'Explicit owner authorization for T-005 is required',
);
await verifyDesktopWorkflow('reclamation', { SKARO_RC3_CLEANUP_TASK: 'T-005' });
