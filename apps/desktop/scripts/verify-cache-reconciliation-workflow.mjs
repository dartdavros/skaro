import { verifyDesktopWorkflow } from './verify-desktop-workflow.mjs';

const project = 'b1a0a1fc-5435-4b37-a30a-c2b3d6c06f1b';
const intent = process.env.SKARO_RC3_CACHE_FAILED_INTENT;
if (
  process.env.SKARO_RC3_CACHE_PROJECT !== project ||
  process.env.SKARO_RC3_CACHE_PHASE !== 'reconcile-public-downloads' ||
  typeof intent !== 'string' ||
  !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(intent)
)
  throw new Error('Exact owner-selected failed cache attempt must be explicitly selected');
await verifyDesktopWorkflow('cache-reconciliation', {
  SKARO_RC3_CACHE_PROJECT: project,
  SKARO_RC3_CACHE_PHASE: 'reconcile-public-downloads',
  SKARO_RC3_CACHE_FAILED_INTENT: intent,
});
