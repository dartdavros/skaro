import { verifyDesktopWorkflow } from './verify-desktop-workflow.mjs';
if (process.env.SKARO_RC3_CACHE_PHASE !== 'buildkit-created-diagnostic')
  throw new Error('Exact read-only diagnostic phase required');
await verifyDesktopWorkflow('cache-buildkit-diagnostic', {
  SKARO_RC3_CACHE_PHASE: process.env.SKARO_RC3_CACHE_PHASE,
});
